import {
  auditLog,
  type Db,
  documents,
  integrations as integrationsTable,
  mcpServers,
  rawEvents,
  users,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { rawEventVisibleToUser } from '#src/visibility.js';

type Visibility = 'private' | 'team' | 'specific_users';

export type AuditAction =
  | 'event.detail_read'
  | 'document.detail_read'
  | 'document.signed_url'
  | 'document.visibility_change'
  | 'team.export_create'
  | 'team.export_download'
  | 'job.retry'
  | 'job.dismiss'
  | 'settings.change'
  | 'integration.connect'
  | 'integration.disconnect'
  | 'integration.settings_change'
  | 'mcp.connect'
  | 'mcp.disconnect'
  | 'mcp.settings_change'
  | 'slack.connect'
  | 'slack.disconnect'
  | 'slack.settings_change';

export interface AuditRecordInput {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  targetVisibility?: Visibility | null;
  targetOwnerUserId?: string | null;
  targetVisibilityUserIds?: string[] | null;
  metadata?: Record<string, unknown>;
}

export interface AuditListRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  redacted: boolean;
  actor: { id: string | null; name: string | null; email: string | null };
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export function canSeeAuditTarget(
  viewerUserId: string,
  target: {
    targetVisibility: Visibility | null;
    targetOwnerUserId: string | null;
    targetVisibilityUserIds: string[] | null;
  },
): boolean {
  if (!target.targetVisibility || target.targetVisibility === 'team') return true;
  if (target.targetVisibility === 'private') return target.targetOwnerUserId === viewerUserId;
  return (target.targetVisibilityUserIds ?? []).includes(viewerUserId);
}

function genericLabel(targetType: string, redacted: boolean): string {
  if (!redacted) return targetType.replace(/_/g, ' ');
  if (targetType === 'raw_event') return 'Restricted event';
  if (targetType === 'document') return 'Restricted document';
  if (targetType === 'mcp_server') return 'Restricted MCP server';
  return `Restricted ${targetType.replace(/_/g, ' ')}`;
}

function unavailableLabel(targetType: string): string {
  if (targetType === 'raw_event') return 'Unavailable event';
  if (targetType === 'document') return 'Unavailable document';
  if (targetType === 'integration') return 'Deleted integration';
  if (targetType === 'mcp_server') return 'Deleted MCP server';
  return `Unavailable ${targetType.replace(/_/g, ' ')}`;
}

const hydratedTargetTypes = new Set(['raw_event', 'document', 'integration', 'mcp_server']);

export function auditTargetPresentation(args: {
  targetType: string;
  targetId: string | null;
  visible: boolean;
  label?: string | undefined;
}): { targetLabel: string; redacted: boolean } {
  const missingHydratedTarget =
    args.visible &&
    Boolean(args.targetId) &&
    hydratedTargetTypes.has(args.targetType) &&
    !args.label;
  const redacted = !args.visible;
  return {
    targetLabel:
      args.label ??
      (missingHydratedTarget
        ? unavailableLabel(args.targetType)
        : genericLabel(args.targetType, redacted)),
    redacted,
  };
}

export function createAuditScope(deps: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}) {
  const { db, teamId, userId, ensureMember } = deps;

  async function record(input: AuditRecordInput): Promise<void> {
    await ensureMember();
    await db.insert(auditLog).values({
      teamId,
      actorUserId: userId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetVisibility: input.targetVisibility ?? null,
      targetOwnerUserId: input.targetOwnerUserId ?? null,
      targetVisibilityUserIds: input.targetVisibilityUserIds ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async function list(limit = 200): Promise<AuditListRow[]> {
    await ensureMember('admin');
    const rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        targetVisibility: auditLog.targetVisibility,
        targetOwnerUserId: auditLog.targetOwnerUserId,
        targetVisibilityUserIds: auditLog.targetVisibilityUserIds,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(eq(auditLog.teamId, teamId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    const idsByType = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.targetId) continue;
      const ids = idsByType.get(row.targetType) ?? [];
      ids.push(row.targetId);
      idsByType.set(row.targetType, ids);
    }

    const eventLabels = new Map<string, string>();
    const eventIds = idsByType.get('raw_event') ?? [];
    if (eventIds.length > 0) {
      const visibleEvents = await db
        .select({ id: rawEvents.id, source: rawEvents.source, occurredAt: rawEvents.occurredAt })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            inArray(rawEvents.id, eventIds),
            rawEventVisibleToUser(userId),
          ),
        );
      for (const event of visibleEvents) {
        eventLabels.set(event.id, `${event.source} event · ${event.occurredAt.toISOString()}`);
      }
    }

    const documentLabels = new Map<string, string>();
    const documentIds = idsByType.get('document') ?? [];
    if (documentIds.length > 0) {
      const visibleDocuments = await db
        .select({ id: documents.id, name: documents.name })
        .from(documents)
        .where(
          and(
            eq(documents.teamId, teamId),
            inArray(documents.id, documentIds),
            isNull(documents.deletedAt),
            or(
              eq(documents.visibility, 'team'),
              and(eq(documents.visibility, 'private'), eq(documents.ownerUserId, userId)),
              eq(documents.ownerUserId, userId),
              and(
                eq(documents.visibility, 'specific_users'),
                sql`${userId}::uuid = ANY(${documents.visibilityUserIds})`,
              ),
            ),
          ),
        );
      for (const doc of visibleDocuments) documentLabels.set(doc.id, doc.name);
    }

    const integrationLabels = new Map<string, string>();
    const integrationIds = idsByType.get('integration') ?? [];
    if (integrationIds.length > 0) {
      const integrations = await db
        .select({ id: integrationsTable.id, provider: integrationsTable.provider })
        .from(integrationsTable)
        .where(
          and(eq(integrationsTable.teamId, teamId), inArray(integrationsTable.id, integrationIds)),
        );
      for (const integration of integrations)
        integrationLabels.set(integration.id, integration.provider);
    }

    const mcpLabels = new Map<string, string>();
    const mcpIds = idsByType.get('mcp_server') ?? [];
    if (mcpIds.length > 0) {
      const servers = await db
        .select({ id: mcpServers.id, name: mcpServers.name })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.teamId, teamId),
            inArray(mcpServers.id, mcpIds),
            or(isNull(mcpServers.userId), eq(mcpServers.userId, userId)),
          ),
        );
      for (const server of servers) mcpLabels.set(server.id, server.name);
    }

    return rows.map((row) => {
      const visible = canSeeAuditTarget(userId, {
        targetVisibility: row.targetVisibility,
        targetOwnerUserId: row.targetOwnerUserId,
        targetVisibilityUserIds: row.targetVisibilityUserIds,
      });
      const label =
        visible && row.targetId && row.targetType === 'raw_event'
          ? eventLabels.get(row.targetId)
          : visible && row.targetId && row.targetType === 'document'
            ? documentLabels.get(row.targetId)
            : visible && row.targetId && row.targetType === 'integration'
              ? integrationLabels.get(row.targetId)
              : visible && row.targetId && row.targetType === 'mcp_server'
                ? mcpLabels.get(row.targetId)
                : undefined;
      const presentation = auditTargetPresentation({
        targetType: row.targetType,
        targetId: row.targetId,
        visible,
        label,
      });
      return {
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: presentation.targetLabel,
        redacted: presentation.redacted,
        actor: { id: row.actorId, name: row.actorName, email: row.actorEmail },
        metadata: row.metadata as Record<string, unknown>,
        createdAt: row.createdAt,
      };
    });
  }

  return { record, list };
}

export type AuditScope = ReturnType<typeof createAuditScope>;
