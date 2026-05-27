import {
  type Db,
  auditLog,
  entities,
  integrationAuditLog,
  integrationProvider,
  integrationSelections,
  integrationSyncState,
  integrations as integrationsTable,
  rawEvents,
  teamMembers,
} from '@timeline/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { decryptJson, encryptJson } from '../crypto/secrets.js';

import type { IntegrationRow } from './types.js';

// Phase 11 — Team-scoped integration helpers. Every read/write goes
// through `withTeam`-style membership enforcement so a forged team_id
// cannot leak another team's tokens.

const _providerValues = integrationProvider.enumValues;
export type IntegrationProviderName = (typeof _providerValues)[number];

export interface CreateIntegrationInput {
  provider: IntegrationProviderName;
  displayName: string;
  externalAccountId?: string | null;
  scopes?: string[];
  tokens?: Record<string, unknown>;
  visibilityDefault?: 'team' | 'private' | 'specific_users';
}

export function createIntegrationScope(deps: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
}) {
  const { db, teamId, userId, ensureMember } = deps;

  async function listIntegrations(): Promise<IntegrationRow[]> {
    await ensureMember();
    return db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.teamId, teamId))
      .orderBy(desc(integrationsTable.createdAt));
  }

  async function getIntegration(id: string): Promise<IntegrationRow | null> {
    await ensureMember();
    const rows = await db
      .select()
      .from(integrationsTable)
      .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getIntegrationTokens(id: string): Promise<Record<string, unknown> | null> {
    const row = await getIntegration(id);
    if (!row?.authSecretCiphertext || !row.authSecretIv || !row.authSecretTag) return null;
    return decryptJson({
      ciphertext: row.authSecretCiphertext,
      iv: row.authSecretIv,
      tag: row.authSecretTag,
    }) as Record<string, unknown>;
  }

  async function createIntegration(input: CreateIntegrationInput): Promise<IntegrationRow> {
    await ensureMember('admin');
    const encrypted = input.tokens ? encryptJson(input.tokens) : undefined;
    return db.transaction(async (tx) => {
      const rows = await tx
        .insert(integrationsTable)
        .values({
          teamId,
          connectedByUserId: userId,
          provider: input.provider,
          displayName: input.displayName,
          externalAccountId: input.externalAccountId ?? null,
          scopes: input.scopes ?? [],
          authSecretCiphertext: encrypted?.ciphertext ?? null,
          authSecretIv: encrypted?.iv ?? null,
          authSecretTag: encrypted?.tag ?? null,
          visibilityDefault: input.visibilityDefault ?? 'team',
        })
        .onConflictDoUpdate({
          target: [
            integrationsTable.teamId,
            integrationsTable.provider,
            integrationsTable.externalAccountId,
          ],
          // Reconnect refreshes the tokens + display name + clears the
          // last error, but does NOT silently re-enable an integration an
          // admin explicitly disabled. The admin must flip `enabled` back
          // on via the settings UI — otherwise an OAuth reconnect would
          // resume a paused sync without anyone asking.
          set: {
            // Refresh the connector to whichever admin re-authenticated —
            // otherwise downstream paths like the Drive document-harvest
            // run withTeam under the original (possibly long-gone) user
            // id, which can mis-attribute or fail on visibility checks
            // if that user has since left the team.
            connectedByUserId: userId,
            displayName: input.displayName,
            scopes: input.scopes ?? [],
            authSecretCiphertext: encrypted?.ciphertext ?? null,
            authSecretIv: encrypted?.iv ?? null,
            authSecretTag: encrypted?.tag ?? null,
            lastError: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Failed to create integration');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.connect',
        targetType: 'integration',
        targetId: row.id,
        targetVisibility: 'team',
        metadata: { provider: row.provider, scope_count: row.scopes?.length ?? 0 },
      });
      return row;
    });
  }

  async function updateIntegrationTokens(
    id: string,
    tokens: Record<string, unknown>,
  ): Promise<void> {
    await ensureMember('admin');
    const encrypted = encryptJson(tokens);
    await db
      .update(integrationsTable)
      .set({
        authSecretCiphertext: encrypted.ciphertext,
        authSecretIv: encrypted.iv,
        authSecretTag: encrypted.tag,
        updatedAt: new Date(),
      })
      .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)));
  }

  async function setIntegrationEnabled(id: string, enabled: boolean): Promise<void> {
    await ensureMember('admin');
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(integrationsTable)
        .set({ enabled, updatedAt: new Date() })
        .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)))
        .returning({ id: integrationsTable.id });
      const row = rows[0];
      if (!row) throw new Error('Integration not found');
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.settings_change',
        targetType: 'integration',
        targetId: row.id,
        targetVisibility: 'team',
        metadata: { field: 'enabled', enabled },
      });
    });
  }

  async function deleteIntegration(id: string): Promise<void> {
    await ensureMember('admin');
    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: integrationsTable.id, provider: integrationsTable.provider })
        .from(integrationsTable)
        .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new Error('Integration not found');
      await tx
        .delete(integrationsTable)
        .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.disconnect',
        targetType: 'integration',
        targetId: id,
        targetVisibility: 'team',
        metadata: { provider: existing.provider },
      });
    });
  }

  async function recordError(id: string, error: string | null): Promise<void> {
    await db
      .update(integrationsTable)
      .set({ lastError: error, updatedAt: new Date() })
      .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)));
  }

  async function markSynced(id: string): Promise<void> {
    await db
      .update(integrationsTable)
      .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)));
  }

  // ---------------- selections (folders / projects / repos) ----------------

  async function listSelections(integrationId: string) {
    await ensureMember();
    // Verify the integration belongs to this team before reading its selections.
    const integration = await getIntegration(integrationId);
    if (!integration) return [];
    return db
      .select()
      .from(integrationSelections)
      .where(eq(integrationSelections.integrationId, integrationId));
  }

  async function setSelections(
    integrationId: string,
    selections: { kind: string; externalId: string; label?: string | null }[],
  ): Promise<void> {
    await ensureMember('admin');
    const integration = await getIntegration(integrationId);
    if (!integration) throw new Error('Integration not found');
    // Replace strategy: simpler than diffing and idempotent on resync.
    await db.transaction(async (tx) => {
      await tx
        .delete(integrationSelections)
        .where(eq(integrationSelections.integrationId, integrationId));
      if (selections.length > 0) {
        await tx.insert(integrationSelections).values(
          selections.map((s) => ({
            integrationId,
            selectionKind: s.kind,
            externalId: s.externalId,
            externalLabel: s.label ?? null,
          })),
        );
      }
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.settings_change',
        targetType: 'integration',
        targetId: integrationId,
        targetVisibility: 'team',
        metadata: { field: 'selections', selection_count: selections.length },
      });
    });
  }

  // ---------------- sync cursor ----------------

  async function loadCursor(integrationId: string, resourceType: string): Promise<unknown> {
    await ensureMember();
    const rows = await db
      .select({ cursor: integrationSyncState.cursor })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.integrationId, integrationId),
          eq(integrationSyncState.resourceType, resourceType),
        ),
      )
      .limit(1);
    return rows[0]?.cursor ?? {};
  }

  async function saveCursor(
    integrationId: string,
    resourceType: string,
    cursor: unknown,
    status: { lastStatus?: string; lastError?: string | null } = {},
  ): Promise<void> {
    await db
      .insert(integrationSyncState)
      .values({
        integrationId,
        resourceType,
        cursor: cursor,
        lastRunAt: new Date(),
        lastStatus: status.lastStatus ?? 'ok',
        lastError: status.lastError ?? null,
      })
      .onConflictDoUpdate({
        target: [integrationSyncState.integrationId, integrationSyncState.resourceType],
        set: {
          cursor: cursor,
          lastRunAt: new Date(),
          lastStatus: status.lastStatus ?? 'ok',
          lastError: status.lastError ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async function listSyncState(integrationId: string) {
    await ensureMember();
    const integration = await getIntegration(integrationId);
    if (!integration) return [];
    return db
      .select()
      .from(integrationSyncState)
      .where(eq(integrationSyncState.integrationId, integrationId));
  }

  // ---------------- audit log ----------------

  async function recordAudit(
    kind: string,
    payload: Record<string, unknown>,
    integrationId?: string | null,
  ): Promise<void> {
    await db.insert(integrationAuditLog).values({
      teamId,
      integrationId: integrationId ?? null,
      actorUserId: userId,
      kind,
      payload,
    });
  }

  async function listAudit(integrationId?: string | null, limit = 100) {
    // Defense in depth: the /app/team/integrations/audit page admin-gates
    // before calling, but a future caller might forget. Audit rows
    // contain provider metadata + sync error payloads that the rest of
    // the integration surface restricts to admins.
    await ensureMember('admin');
    const conditions = [eq(integrationAuditLog.teamId, teamId)];
    if (integrationId) {
      conditions.push(eq(integrationAuditLog.integrationId, integrationId));
    }
    return db
      .select()
      .from(integrationAuditLog)
      .where(and(...conditions))
      .orderBy(desc(integrationAuditLog.createdAt))
      .limit(limit);
  }

  /**
   * Phase 11 — Resolve the current state of a synced external object.
   * Returns the workspace entity row (if mapped) plus the most recent
   * integration_event for that external_object_id. Used by the agent's
   * `get_integration_resource` tool.
   */
  async function getIntegrationResource(input: {
    provider: string;
    externalObjectId: string;
    historyLimit?: number;
  }): Promise<{
    entity: typeof entities.$inferSelect | null;
    history: { id: string; occurredAt: Date; eventType: string; contentText: string | null }[];
  } | null> {
    await ensureMember();
    const ent = await db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, teamId),
          sql`(${entities.metadata} ->> 'integration_provider') = ${input.provider}`,
          sql`(${entities.metadata} ->> 'integration_external_id') = ${input.externalObjectId}`,
        ),
      )
      .limit(1);
    // Same visibility predicate the rest of withTeam applies on raw_events.
    // Without it, a non-author team member could read history rows whose
    // `visibility` is `private` (only the author should see) or
    // `specific_users` (only the named ids should see) via the agent's
    // get_integration_resource tool — bypassing the gate that
    // getEventsByIds and searchEvents enforce.
    const integrationVisibility = or(
      eq(rawEvents.visibility, 'team'),
      and(eq(rawEvents.visibility, 'private'), eq(rawEvents.authorUserId, userId)),
      and(
        eq(rawEvents.visibility, 'specific_users'),
        sql`${userId}::uuid = ANY(${rawEvents.visibilityUserIds})`,
      ),
    );
    const events = await db
      .select({
        id: rawEvents.id,
        occurredAt: rawEvents.occurredAt,
        eventType: sql<string>`${rawEvents.sourceMetadata} ->> 'event_type'`,
        contentText: rawEvents.contentText,
      })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(rawEvents.source, 'integration'),
          sql`(${rawEvents.sourceMetadata} ->> 'provider') = ${input.provider}`,
          sql`(${rawEvents.sourceMetadata} ->> 'external_object_id') = ${input.externalObjectId}`,
          integrationVisibility,
        ),
      )
      .orderBy(desc(rawEvents.occurredAt))
      .limit(input.historyLimit ?? 20);
    if (ent.length === 0 && events.length === 0) return null;
    return { entity: ent[0] ?? null, history: events };
  }

  return {
    listIntegrations,
    getIntegration,
    getIntegrationTokens,
    createIntegration,
    updateIntegrationTokens,
    setIntegrationEnabled,
    deleteIntegration,
    recordError,
    markSynced,
    listSelections,
    setSelections,
    loadCursor,
    saveCursor,
    listSyncState,
    recordAudit,
    listAudit,
    getIntegrationResource,
  };
}

export type IntegrationScope = ReturnType<typeof createIntegrationScope>;

// Lightweight admin helper used by the worker (no withTeam scope yet at
// boot). The worker resolves an integration id → its team_id → drives
// sync for that team. Membership is implicitly enforced by FK: the
// integration row's team_id is the only team it can touch.
export async function adminLoadIntegration(
  db: Db,
  integrationId: string,
): Promise<IntegrationRow | null> {
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.id, integrationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function adminListEnabledIntegrations(db: Db): Promise<IntegrationRow[]> {
  return db.select().from(integrationsTable).where(eq(integrationsTable.enabled, true));
}

export function adminDecryptTokens(row: IntegrationRow): Record<string, unknown> | null {
  if (!row.authSecretCiphertext || !row.authSecretIv || !row.authSecretTag) return null;
  return decryptJson({
    ciphertext: row.authSecretCiphertext,
    iv: row.authSecretIv,
    tag: row.authSecretTag,
  }) as Record<string, unknown>;
}

export async function adminPersistTokens(
  db: Db,
  integrationId: string,
  tokens: Record<string, unknown>,
): Promise<void> {
  const enc = encryptJson(tokens);
  await db
    .update(integrationsTable)
    .set({
      authSecretCiphertext: enc.ciphertext,
      authSecretIv: enc.iv,
      authSecretTag: enc.tag,
      updatedAt: new Date(),
    })
    .where(eq(integrationsTable.id, integrationId));
}

export async function adminVerifyTeamMember(
  db: Db,
  teamId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function adminRecordAudit(
  db: Db,
  teamId: string,
  kind: string,
  payload: Record<string, unknown>,
  opts: { integrationId?: string | null; actorUserId?: string | null } = {},
): Promise<void> {
  await db.insert(integrationAuditLog).values({
    teamId,
    integrationId: opts.integrationId ?? null,
    actorUserId: opts.actorUserId ?? null,
    kind,
    payload,
  });
}

export async function adminSaveCursor(
  db: Db,
  integrationId: string,
  resourceType: string,
  cursor: unknown,
  status: { lastStatus?: string; lastError?: string | null } = {},
): Promise<void> {
  await db
    .insert(integrationSyncState)
    .values({
      integrationId,
      resourceType,
      cursor: cursor,
      lastRunAt: new Date(),
      lastStatus: status.lastStatus ?? 'ok',
      lastError: status.lastError ?? null,
    })
    .onConflictDoUpdate({
      target: [integrationSyncState.integrationId, integrationSyncState.resourceType],
      set: {
        cursor: cursor,
        lastRunAt: new Date(),
        lastStatus: status.lastStatus ?? 'ok',
        lastError: status.lastError ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function adminLoadCursor(
  db: Db,
  integrationId: string,
  resourceType: string,
): Promise<unknown> {
  const rows = await db
    .select({ cursor: integrationSyncState.cursor })
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.integrationId, integrationId),
        eq(integrationSyncState.resourceType, resourceType),
      ),
    )
    .limit(1);
  return rows[0]?.cursor ?? {};
}

export async function adminMarkSynced(db: Db, integrationId: string): Promise<void> {
  await db
    .update(integrationsTable)
    .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(integrationsTable.id, integrationId));
}

export async function adminRecordError(
  db: Db,
  integrationId: string,
  error: string,
): Promise<void> {
  await db
    .update(integrationsTable)
    .set({ lastError: error, updatedAt: new Date() })
    .where(eq(integrationsTable.id, integrationId));
}

export async function adminListSelections(
  db: Db,
  integrationId: string,
): Promise<{ kind: string; externalId: string; label: string | null }[]> {
  const rows = await db
    .select()
    .from(integrationSelections)
    .where(eq(integrationSelections.integrationId, integrationId));
  return rows.map((r) => ({
    kind: r.selectionKind,
    externalId: r.externalId,
    label: r.externalLabel,
  }));
}

// Avoid unused-import warning — sql is reserved for future advisory locks on
// integration ids when a worker concurrency knob lands.
void sql;
