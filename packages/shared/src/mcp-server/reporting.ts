import { randomUUID } from 'node:crypto';

import {
  type Db,
  type AgentReportingPreference,
  teams,
  mcpOutboundKeys,
  mcpOutboundOAuthGrants,
  auditLog,
} from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { McpAuthPrincipal } from '#src/mcp-server/oauth-core.js';

export const reportingInput = z
  .object({
    mode: z.enum(['on_request', 'handoffs']),
    scope: z.string().trim().max(1000).default(''),
  })
  .refine(
    (value) => value.mode !== 'handoffs' || value.scope.length > 0,
    'Describe the work scope for ongoing reporting',
  );
export function effectiveReporting(
  defaults: AgentReportingPreference,
  override: AgentReportingPreference | null,
) {
  return override ?? defaults;
}
class ReportingConsentError extends Error {
  override name = 'ReportingConsentError';
}

export function prepareConsentReporting(
  raw: unknown,
  current: AgentReportingPreference | null,
  role: string,
  scopes: string[],
) {
  if (raw === undefined) return { changed: false, preference: current };
  const command = z
    .object({
      mode: z.enum(['preserve', 'inherit', 'on_request', 'handoffs']),
      scope: z.string().max(1000).optional(),
    })
    .strict()
    .safeParse(raw);
  if (!command.success)
    throw new ReportingConsentError(
      'Check the reporting mode and work scope (maximum 1,000 characters).',
    );
  if (command.data.mode === 'preserve') return { changed: false, preference: current };
  if (role !== 'owner' && role !== 'admin')
    throw new ReportingConsentError(
      'Only workspace owners and admins can change reporting preferences.',
    );
  if (command.data.mode === 'inherit') return { changed: current !== null, preference: null };
  const parsed = reportingInput.safeParse(command.data);
  if (!parsed.success)
    throw new ReportingConsentError(
      'Describe the work scope for ongoing reporting (maximum 1,000 characters).',
    );
  if (parsed.data.mode === 'handoffs' && !scopes.includes('capture'))
    throw new ReportingConsentError(
      'Enable capture permission to select ongoing reporting, or choose another reporting option.',
    );
  if (current?.mode === parsed.data.mode && current.scope === parsed.data.scope)
    return { changed: false, preference: current };
  return { changed: true, preference: { ...parsed.data, revision: randomUUID() } };
}

export async function recordReportingChange(
  tx: Pick<Db, 'insert'>,
  teamId: string,
  userId: string,
  target: { type: string; id?: string },
  preference: AgentReportingPreference | null,
) {
  await tx.insert(auditLog).values({
    teamId,
    actorUserId: userId,
    action: 'agent.reporting.updated',
    targetType: target.type,
    targetId: target.id ?? teamId,
    metadata: { mode: preference?.mode ?? 'inherit', revision: preference?.revision },
  });
}

export function createAgentReportingScope({
  db,
  teamId,
  userId,
  ensureMember,
}: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}) {
  async function current(principal: McpAuthPrincipal) {
    await ensureMember();
    if (principal.teamId !== teamId || principal.userId !== userId)
      throw new Error('Connection principal mismatch');
    const [team] = await db
      .select({ id: teams.id, name: teams.name, preference: teams.agentReporting })
      .from(teams)
      .where(eq(teams.id, teamId));
    if (!team) throw new Error('Workspace unavailable');
    const table = principal.authType === 'oauth' ? mcpOutboundOAuthGrants : mcpOutboundKeys;
    const [connection] = await db
      .select({ id: table.id, preference: table.agentReporting })
      .from(table)
      .where(and(eq(table.id, principal.keyId), eq(table.teamId, teamId), isNull(table.revokedAt)));
    if (!connection) throw new Error('Connection unavailable');
    return {
      team: { id: team.id, name: team.name },
      connection: { id: connection.id, type: principal.authType, clientId: principal.clientId },
      scopes: principal.scopes,
      reporting: effectiveReporting(team.preference, connection.preference),
    };
  }
  async function consentContext(clientId: string) {
    await ensureMember();
    const [team] = await db
      .select({ defaults: teams.agentReporting })
      .from(teams)
      .where(eq(teams.id, teamId));
    if (!team) throw new Error('Workspace unavailable');
    const [grant] = await db
      .select({ preference: mcpOutboundOAuthGrants.agentReporting })
      .from(mcpOutboundOAuthGrants)
      .where(
        and(
          eq(mcpOutboundOAuthGrants.teamId, teamId),
          eq(mcpOutboundOAuthGrants.userId, userId),
          eq(mcpOutboundOAuthGrants.clientId, clientId),
        ),
      );
    return { defaults: team.defaults, override: grant?.preference ?? null };
  }
  async function list() {
    await ensureMember('admin');
    const [team] = await db
      .select({ preference: teams.agentReporting })
      .from(teams)
      .where(eq(teams.id, teamId));
    const [keys, grants] = await Promise.all([
      db
        .select({
          id: mcpOutboundKeys.id,
          name: mcpOutboundKeys.name,
          preference: mcpOutboundKeys.agentReporting,
        })
        .from(mcpOutboundKeys)
        .where(and(eq(mcpOutboundKeys.teamId, teamId), isNull(mcpOutboundKeys.revokedAt))),
      db
        .select({
          id: mcpOutboundOAuthGrants.id,
          name: mcpOutboundOAuthGrants.clientId,
          preference: mcpOutboundOAuthGrants.agentReporting,
        })
        .from(mcpOutboundOAuthGrants)
        .where(
          and(eq(mcpOutboundOAuthGrants.teamId, teamId), isNull(mcpOutboundOAuthGrants.revokedAt)),
        ),
    ]);
    return {
      defaults: team?.preference ?? { mode: 'on_request' as const, scope: '', revision: '0' },
      connections: [
        ...keys.map((row) => ({ ...row, type: 'api_key' as const })),
        ...grants.map((row) => ({ ...row, type: 'oauth' as const })),
      ],
    };
  }
  async function update(
    target: { type: 'workspace' | 'api_key' | 'oauth'; id?: string },
    raw: unknown,
  ) {
    await ensureMember('admin');
    const preference =
      raw === null ? null : { ...reportingInput.parse(raw), revision: randomUUID() };
    await db.transaction(async (tx) => {
      if (target.type === 'workspace') {
        if (!preference) throw new Error('Workspace default required');
        await tx.update(teams).set({ agentReporting: preference }).where(eq(teams.id, teamId));
      } else {
        if (!target.id) throw new Error('Connection required');
        const table = target.type === 'oauth' ? mcpOutboundOAuthGrants : mcpOutboundKeys;
        const rows = await tx
          .update(table)
          .set({ agentReporting: preference })
          .where(and(eq(table.id, target.id), eq(table.teamId, teamId), isNull(table.revokedAt)))
          .returning({ id: table.id });
        if (!rows.length) throw new Error('Connection unavailable');
      }
      await recordReportingChange(tx, teamId, userId, target, preference);
    });
  }
  return { current, list, update, consentContext };
}
