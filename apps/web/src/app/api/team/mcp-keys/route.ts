import { auditLog, mcpOutboundKeys } from '@timeline/db';
import { childLogger } from '@timeline/shared/logger';
import * as mcpServer from '@timeline/shared/mcp-server';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  allowAgent: z.boolean().optional().default(false),
});

const log = childLogger('web:mcp-keys');

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.teamId, active.teamId), isNull(mcpOutboundKeys.revokedAt)))
    .orderBy(desc(mcpOutboundKeys.createdAt));
  return NextResponse.json({
    keys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.keyPrefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body: unknown = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const minted = mcpServer.mintKey();
  const row = await db
    .transaction(async (tx) => {
      const rows = await tx
        .insert(mcpOutboundKeys)
        .values({
          teamId: active.teamId,
          createdByUserId: session.user.id,
          name: parsed.data.name,
          keyHash: minted.hash,
          keyPrefix: minted.prefix,
          scopes: parsed.data.allowAgent ? ['read', 'agent:ask'] : ['read'],
        })
        .returning();
      const created = rows[0];
      if (!created) throw new Error('create_failed');
      await tx.insert(auditLog).values({
        teamId: active.teamId,
        actorUserId: session.user.id,
        action: 'mcp.connect',
        targetType: 'mcp_outbound_key',
        targetId: created.id,
        targetVisibility: 'team',
        metadata: {
          surface: 'timeline_as_mcp_server',
          scope_count: Array.isArray(created.scopes) ? created.scopes.length : 0,
        },
      });
      return created;
    })
    .catch((err: unknown) => {
      log.error(
        { err, teamId: active.teamId, actorUserId: session.user.id },
        'Failed to create outbound MCP key',
      );
      reportCaughtError(err, { surface: 'api', operation: 'create_outbound_mcp_key' });
      return null;
    });
  if (!row) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  trackProductEventBestEffort(
    { kind: 'user', userId: session.user.id, teamId: active.teamId },
    'integration_management_action_completed',
    { action: 'mcp_key_mint', kind: 'mcp_outbound' },
  );
  // One-time plaintext — the only response that ever contains it.
  return NextResponse.json({
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    plaintext: minted.plaintext,
    scopes: row.scopes,
    createdAt: row.createdAt,
  });
}
