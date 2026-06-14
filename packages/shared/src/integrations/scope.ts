import {
  type Db,
  auditLog,
  connectionAttention,
  entities,
  integrationAuditLog,
  integrationProvider,
  integrationSelections,
  integrationSyncState,
  integrations as integrationsTable,
  notifications,
  providerConnections,
  rawEvents,
  teamProviderResourceShares,
  teamMembers,
  teams,
  users,
} from '@timeline/db';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { IntegrationRow, ProviderConnectionRow } from '#src/integrations/types.js';

import { decryptJson, encryptJson } from '#src/crypto/secrets.js';
import { sendConnectionAttentionEmail } from '#src/email/outbound.js';
import { rawEventVisibleToUser, validateVisibilityUserIds } from '#src/visibility.js';

// Phase 11 — Team-scoped integration helpers. Every read/write goes
// through `withTeam`-style membership enforcement so a forged team_id
// cannot leak another team's tokens.

const _providerValues = integrationProvider.enumValues;
export type IntegrationProviderName = (typeof _providerValues)[number];

export interface CreateIntegrationInput {
  provider: IntegrationProviderName;
  displayName: string;
  externalAccountId?: string | null;
  providerConnectionId?: string | null;
  scopes?: string[];
  tokens?: Record<string, unknown>;
  visibilityDefault?: 'team' | 'private' | 'specific_users';
  visibilityDefaultUserIds?: string[] | null;
}

export interface UpsertProviderConnectionInput {
  provider: Exclude<IntegrationProviderName, 'mcp'>;
  displayName: string;
  externalAccountId: string;
  scopes?: string[];
  tokens: Record<string, unknown>;
}

export interface ConnectionAttentionInput {
  providerConnectionId?: string | null;
  integrationId?: string | null;
  resourceShareId?: string | null;
  category: 'needs_reconnect' | 'needs_new_owner' | 'access_changed' | 'sync_error';
  summary: string;
}

export interface ResolveConnectionAttentionInput {
  providerConnectionId?: string | null | undefined;
  integrationId?: string | null | undefined;
  resourceShareId?: string | null | undefined;
  categories?: ConnectionAttentionInput['category'][];
}

const transientSyncResourceType = 'integration.run';
const transientSyncAttentionThreshold = 3;
const connectionAttentionCategoryValues: ConnectionAttentionInput['category'][] = [
  'needs_reconnect',
  'needs_new_owner',
  'access_changed',
  'sync_error',
];

export function createIntegrationScope(deps: {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (minRole?: 'member' | 'admin' | 'owner') => Promise<unknown>;
  requireTeamMember?: (otherUserId: string) => Promise<void>;
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
    if (row?.providerConnectionId) {
      return getProviderConnectionTokens(row.providerConnectionId);
    }
    if (!row?.authSecretCiphertext || !row.authSecretIv || !row.authSecretTag) return null;
    return decryptJson({
      ciphertext: row.authSecretCiphertext,
      iv: row.authSecretIv,
      tag: row.authSecretTag,
    }) as Record<string, unknown>;
  }

  async function listOwnedProviderConnections(): Promise<ProviderConnectionRow[]> {
    await ensureMember();
    return db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.ownerUserId, userId))
      .orderBy(desc(providerConnections.updatedAt));
  }

  async function getProviderConnection(id: string): Promise<ProviderConnectionRow | null> {
    await ensureMember();
    const rows = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getOwnedProviderConnection(id: string): Promise<ProviderConnectionRow | null> {
    await ensureMember();
    const rows = await db
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, id), eq(providerConnections.ownerUserId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getProviderConnectionTokens(id: string): Promise<Record<string, unknown> | null> {
    const row = await getProviderConnection(id);
    if (!row) return null;
    return decryptJson({
      ciphertext: row.authSecretCiphertext,
      iv: row.authSecretIv,
      tag: row.authSecretTag,
    }) as Record<string, unknown>;
  }

  async function upsertProviderConnection(
    input: UpsertProviderConnectionInput,
  ): Promise<ProviderConnectionRow> {
    await ensureMember();
    const encrypted = encryptJson(input.tokens);
    const rows = await db
      .insert(providerConnections)
      .values({
        ownerUserId: userId,
        provider: input.provider,
        displayName: input.displayName,
        externalAccountId: input.externalAccountId,
        scopes: input.scopes ?? [],
        authSecretCiphertext: encrypted.ciphertext,
        authSecretIv: encrypted.iv,
        authSecretTag: encrypted.tag,
        lastError: null,
        lastConnectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          providerConnections.ownerUserId,
          providerConnections.provider,
          providerConnections.externalAccountId,
        ],
        set: {
          displayName: input.displayName,
          scopes: input.scopes ?? [],
          authSecretCiphertext: encrypted.ciphertext,
          authSecretIv: encrypted.iv,
          authSecretTag: encrypted.tag,
          lastError: null,
          lastConnectedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to create provider connection');
    await adminResolveConnectionAttention(db, teamId, {
      providerConnectionId: row.id,
      categories: ['needs_reconnect', 'sync_error'],
    });
    return row;
  }

  async function deleteOwnedProviderConnection(id: string): Promise<void> {
    await ensureMember();
    const connection = await getOwnedProviderConnection(id);
    if (!connection) return;
    const affected = await db
      .select({ teamId: integrationsTable.teamId, integrationId: integrationsTable.id })
      .from(integrationsTable)
      .where(eq(integrationsTable.providerConnectionId, id));
    await db.transaction(async (tx) => {
      await tx
        .update(integrationsTable)
        .set({
          enabled: false,
          lastError: 'Provider connection deleted — replacement required',
          updatedAt: new Date(),
        })
        .where(eq(integrationsTable.providerConnectionId, id));
      await tx.delete(providerConnections).where(eq(providerConnections.id, id));
    });
    await Promise.all(
      affected.map((row) =>
        adminRecordConnectionAttention(db, row.teamId, {
          integrationId: row.integrationId,
          category: 'needs_new_owner',
          summary: `${connection.displayName} was deleted; choose a replacement connection.`,
        }),
      ),
    );
  }

  async function createIntegration(input: CreateIntegrationInput): Promise<IntegrationRow> {
    await ensureMember('admin');
    const encrypted = input.tokens ? encryptJson(input.tokens) : undefined;
    const externalAccountId = input.externalAccountId ?? null;
    const existingVisibility =
      externalAccountId !== null
        ? (
            await db
              .select({
                visibilityDefault: integrationsTable.visibilityDefault,
                visibilityDefaultUserIds: integrationsTable.visibilityDefaultUserIds,
              })
              .from(integrationsTable)
              .where(
                and(
                  eq(integrationsTable.teamId, teamId),
                  eq(integrationsTable.provider, input.provider),
                  eq(integrationsTable.externalAccountId, externalAccountId),
                ),
              )
              .limit(1)
          )[0]
        : null;
    const visibilityDefault =
      existingVisibility?.visibilityDefault ?? input.visibilityDefault ?? 'team';
    const visibilityDefaultUserIds =
      existingVisibility?.visibilityDefaultUserIds ??
      (await validateVisibilityUserIds(
        visibilityDefault,
        input.visibilityDefaultUserIds ?? null,
        deps.requireTeamMember,
      ));
    return db.transaction(async (tx) => {
      const rows = await tx
        .insert(integrationsTable)
        .values({
          teamId,
          connectedByUserId: userId,
          providerConnectionId: input.providerConnectionId ?? null,
          provider: input.provider,
          displayName: input.displayName,
          externalAccountId,
          scopes: input.scopes ?? [],
          authSecretCiphertext: encrypted?.ciphertext ?? null,
          authSecretIv: encrypted?.iv ?? null,
          authSecretTag: encrypted?.tag ?? null,
          visibilityDefault,
          visibilityDefaultUserIds,
        })
        .onConflictDoUpdate({
          target: [
            integrationsTable.teamId,
            integrationsTable.provider,
            integrationsTable.externalAccountId,
          ],
          targetWhere: sql`${integrationsTable.externalAccountId} IS NOT NULL`,
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
            providerConnectionId: input.providerConnectionId ?? null,
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
      if (!row) return;
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

  async function setIntegrationVisibilityDefault(
    id: string,
    visibilityDefault: 'team' | 'private' | 'specific_users',
    visibilityDefaultUserIds?: string[] | null,
  ): Promise<void> {
    await ensureMember('admin');
    const normalizedUserIds = await validateVisibilityUserIds(
      visibilityDefault,
      visibilityDefaultUserIds,
      deps.requireTeamMember,
    );
    const rows = await db
      .update(integrationsTable)
      .set({
        visibilityDefault,
        visibilityDefaultUserIds: normalizedUserIds,
        updatedAt: new Date(),
      })
      .where(and(eq(integrationsTable.id, id), eq(integrationsTable.teamId, teamId)))
      .returning({ id: integrationsTable.id });
    if (!rows[0]) throw new Error('Integration not found');
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
      if (!existing) return;
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

  // ---------------- provider resource sharing ----------------

  async function listTeamResourceShares() {
    await ensureMember('admin');
    return db
      .select({
        share: teamProviderResourceShares,
        connection: providerConnections,
      })
      .from(teamProviderResourceShares)
      .innerJoin(
        providerConnections,
        eq(teamProviderResourceShares.providerConnectionId, providerConnections.id),
      )
      .where(eq(teamProviderResourceShares.teamId, teamId))
      .orderBy(desc(teamProviderResourceShares.updatedAt));
  }

  async function listOwnedTeamResourceShares() {
    await ensureMember();
    return db
      .select({
        share: teamProviderResourceShares,
        connection: providerConnections,
      })
      .from(teamProviderResourceShares)
      .innerJoin(
        providerConnections,
        eq(teamProviderResourceShares.providerConnectionId, providerConnections.id),
      )
      .where(
        and(
          eq(teamProviderResourceShares.teamId, teamId),
          eq(providerConnections.ownerUserId, userId),
        ),
      )
      .orderBy(desc(teamProviderResourceShares.updatedAt));
  }

  async function shareProviderResources(
    providerConnectionId: string,
    resources: { kind: string; externalId: string; label?: string | null }[],
  ): Promise<void> {
    await ensureMember();
    const connection = await getOwnedProviderConnection(providerConnectionId);
    if (!connection) throw new Error('Provider connection not found');
    const revokedForAttention: (typeof teamProviderResourceShares.$inferSelect)[] = [];
    await db.transaction(async (tx) => {
      const keepKeys = new Set(resources.map((r) => `${r.kind}\x00${r.externalId}`));
      const existing = await tx
        .select()
        .from(teamProviderResourceShares)
        .where(
          and(
            eq(teamProviderResourceShares.teamId, teamId),
            eq(teamProviderResourceShares.providerConnectionId, providerConnectionId),
          ),
        );
      const revokedShares = existing.filter(
        (share) => !keepKeys.has(`${share.resourceKind}\x00${share.externalId}`),
      );
      revokedForAttention.push(...revokedShares);
      for (const share of revokedShares) {
        await tx
          .update(teamProviderResourceShares)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(eq(teamProviderResourceShares.id, share.id));
        await tx
          .delete(integrationSelections)
          .where(eq(integrationSelections.resourceShareId, share.id));
      }
      if (resources.length > 0) {
        await tx
          .insert(teamProviderResourceShares)
          .values(
            resources.map((resource) => ({
              teamId,
              providerConnectionId,
              resourceKind: resource.kind,
              externalId: resource.externalId,
              externalLabel: resource.label ?? null,
              revokedAt: null,
              updatedAt: new Date(),
            })),
          )
          .onConflictDoUpdate({
            target: [
              teamProviderResourceShares.teamId,
              teamProviderResourceShares.providerConnectionId,
              teamProviderResourceShares.resourceKind,
              teamProviderResourceShares.externalId,
            ],
            set: {
              externalLabel: sql`excluded.external_label`,
              revokedAt: null,
              updatedAt: new Date(),
            },
          });
      }
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.resource_share',
        targetType: 'provider_connection',
        targetId: providerConnectionId,
        targetVisibility: 'team',
        metadata: { provider: connection.provider, resource_count: resources.length },
      });
    });
    const currentShares = await db
      .select()
      .from(teamProviderResourceShares)
      .where(
        and(
          eq(teamProviderResourceShares.teamId, teamId),
          eq(teamProviderResourceShares.providerConnectionId, providerConnectionId),
        ),
      );
    await Promise.all([
      ...revokedForAttention.map((share) =>
        recordConnectionAttention({
          providerConnectionId,
          resourceShareId: share.id,
          category: 'access_changed',
          summary: `${share.externalLabel ?? share.externalId} was revoked by ${connection.displayName}.`,
        }),
      ),
      ...currentShares
        .filter((share) =>
          resources.some((r) => r.kind === share.resourceKind && r.externalId === share.externalId),
        )
        .map((share) =>
          adminResolveConnectionAttention(db, teamId, {
            providerConnectionId,
            resourceShareId: share.id,
            categories: ['access_changed'],
          }),
        ),
    ]);
  }

  async function revokeProviderResourceShare(resourceShareId: string): Promise<void> {
    await ensureMember();
    const rows = await db
      .select({
        share: teamProviderResourceShares,
        connection: providerConnections,
      })
      .from(teamProviderResourceShares)
      .innerJoin(
        providerConnections,
        eq(teamProviderResourceShares.providerConnectionId, providerConnections.id),
      )
      .where(
        and(
          eq(teamProviderResourceShares.id, resourceShareId),
          eq(teamProviderResourceShares.teamId, teamId),
          eq(providerConnections.ownerUserId, userId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('Resource share not found');
    await db.transaction(async (tx) => {
      await tx
        .update(teamProviderResourceShares)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(teamProviderResourceShares.id, resourceShareId));
      await tx
        .delete(integrationSelections)
        .where(eq(integrationSelections.resourceShareId, resourceShareId));
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.resource_revoke',
        targetType: 'provider_connection',
        targetId: row.connection.id,
        targetVisibility: 'team',
        metadata: {
          provider: row.connection.provider,
          resource_kind: row.share.resourceKind,
          external_id: row.share.externalId,
        },
      });
    });
    await recordConnectionAttention({
      providerConnectionId: row.connection.id,
      resourceShareId,
      category: 'access_changed',
      summary: `${row.share.externalLabel ?? row.share.externalId} was revoked by ${row.connection.displayName}.`,
    });
  }

  async function activateSharedResources(input: {
    providerConnectionId: string;
    resourceShareIds: string[];
  }): Promise<IntegrationRow> {
    await ensureMember('admin');
    const connectionRows = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, input.providerConnectionId))
      .limit(1);
    const connection = connectionRows[0];
    if (!connection) throw new Error('Provider connection not found');
    const shares =
      input.resourceShareIds.length > 0
        ? await db
            .select()
            .from(teamProviderResourceShares)
            .where(
              and(
                eq(teamProviderResourceShares.teamId, teamId),
                eq(teamProviderResourceShares.providerConnectionId, input.providerConnectionId),
                isNull(teamProviderResourceShares.revokedAt),
                inArray(teamProviderResourceShares.id, input.resourceShareIds),
              ),
            )
        : [];
    if (shares.length !== input.resourceShareIds.length) {
      throw new Error('One or more selected sources are unavailable');
    }

    const replacedIntegrationIds = new Set<string>();
    if (shares.length > 0) {
      const sourcePathConditions = shares.map((share) =>
        and(
          eq(integrationSelections.selectionKind, share.resourceKind),
          eq(integrationSelections.externalId, share.externalId),
        ),
      );
      const existingSourceOwners = await db
        .select({ integrationId: integrationSelections.integrationId })
        .from(integrationSelections)
        .innerJoin(integrationsTable, eq(integrationSelections.integrationId, integrationsTable.id))
        .where(
          and(
            eq(integrationsTable.teamId, teamId),
            sourcePathConditions.length === 1
              ? sourcePathConditions[0]
              : or(...sourcePathConditions),
          ),
        );
      for (const owner of existingSourceOwners) {
        replacedIntegrationIds.add(owner.integrationId);
      }
    }
    const integration = await db.transaction(async (tx) => {
      const integrationRows = await tx
        .insert(integrationsTable)
        .values({
          teamId,
          connectedByUserId: connection.ownerUserId,
          providerConnectionId: connection.id,
          provider: connection.provider,
          displayName: connection.displayName,
          externalAccountId: connection.externalAccountId,
          scopes: connection.scopes ?? [],
          visibilityDefault: 'team',
          visibilityDefaultUserIds: null,
        })
        .onConflictDoUpdate({
          target: [
            integrationsTable.teamId,
            integrationsTable.provider,
            integrationsTable.externalAccountId,
          ],
          targetWhere: sql`${integrationsTable.externalAccountId} IS NOT NULL`,
          set: {
            connectedByUserId: connection.ownerUserId,
            providerConnectionId: connection.id,
            displayName: connection.displayName,
            scopes: connection.scopes ?? [],
            enabled: true,
            lastError: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      const integration = integrationRows[0];
      if (!integration) throw new Error('Failed to activate sources');
      await tx
        .delete(integrationSelections)
        .where(eq(integrationSelections.integrationId, integration.id));
      const teamIntegrationRows = await tx
        .select({ id: integrationsTable.id })
        .from(integrationsTable)
        .where(eq(integrationsTable.teamId, teamId));
      const teamIntegrationIds = teamIntegrationRows.map((row) => row.id);
      for (const share of shares) {
        const duplicateRows = await tx
          .select({ integrationId: integrationSelections.integrationId })
          .from(integrationSelections)
          .where(
            and(
              inArray(integrationSelections.integrationId, teamIntegrationIds),
              eq(integrationSelections.selectionKind, share.resourceKind),
              eq(integrationSelections.externalId, share.externalId),
            ),
          );
        for (const duplicate of duplicateRows) {
          if (duplicate.integrationId !== integration.id) {
            replacedIntegrationIds.add(duplicate.integrationId);
          }
        }
        await tx
          .delete(integrationSelections)
          .where(
            and(
              inArray(integrationSelections.integrationId, teamIntegrationIds),
              eq(integrationSelections.selectionKind, share.resourceKind),
              eq(integrationSelections.externalId, share.externalId),
            ),
          );
      }
      if (shares.length > 0) {
        await tx.insert(integrationSelections).values(
          shares.map((share) => ({
            integrationId: integration.id,
            resourceShareId: share.id,
            selectionKind: share.resourceKind,
            externalId: share.externalId,
            externalLabel: share.externalLabel,
          })),
        );
      }
      await tx.insert(auditLog).values({
        teamId,
        actorUserId: userId,
        action: 'integration.settings_change',
        targetType: 'integration',
        targetId: integration.id,
        targetVisibility: 'team',
        metadata: { field: 'active_source_paths', selection_count: shares.length },
      });
      return integration;
    });
    await adminResolveConnectionAttention(db, teamId, {
      integrationId: integration.id,
      categories: ['needs_new_owner'],
    });
    await Promise.all(
      [...replacedIntegrationIds].map((integrationId) =>
        adminResolveConnectionAttention(db, teamId, {
          integrationId,
          categories: ['needs_new_owner'],
        }),
      ),
    );
    return integration;
  }

  async function listConnectionAttention() {
    await ensureMember();
    return db
      .select()
      .from(connectionAttention)
      .where(and(eq(connectionAttention.teamId, teamId), isNull(connectionAttention.resolvedAt)))
      .orderBy(desc(connectionAttention.lastSeenAt));
  }

  async function recordConnectionAttention(input: ConnectionAttentionInput): Promise<void> {
    await adminRecordConnectionAttention(db, teamId, input);
  }

  async function resolveConnectionAttention(input: ResolveConnectionAttentionInput): Promise<void> {
    await adminResolveConnectionAttention(db, teamId, input);
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
    const integrationVisibility = rawEventVisibleToUser(userId);
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
    listOwnedProviderConnections,
    getProviderConnection,
    getOwnedProviderConnection,
    getProviderConnectionTokens,
    upsertProviderConnection,
    deleteOwnedProviderConnection,
    createIntegration,
    updateIntegrationTokens,
    setIntegrationEnabled,
    setIntegrationVisibilityDefault,
    deleteIntegration,
    recordError,
    markSynced,
    listTeamResourceShares,
    listOwnedTeamResourceShares,
    shareProviderResources,
    revokeProviderResourceShare,
    activateSharedResources,
    listConnectionAttention,
    recordConnectionAttention,
    resolveConnectionAttention,
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

export async function adminLoadProviderConnection(
  db: Db,
  providerConnectionId: string,
): Promise<ProviderConnectionRow | null> {
  const rows = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.id, providerConnectionId))
    .limit(1);
  return rows[0] ?? null;
}

export function decryptProviderConnectionTokens(
  row: ProviderConnectionRow,
): Record<string, unknown> {
  return decryptJson({
    ciphertext: row.authSecretCiphertext,
    iv: row.authSecretIv,
    tag: row.authSecretTag,
  }) as Record<string, unknown>;
}

export async function adminDecryptIntegrationTokens(
  db: Db,
  row: IntegrationRow,
): Promise<Record<string, unknown> | null> {
  if (row.providerConnectionId) {
    const connection = await adminLoadProviderConnection(db, row.providerConnectionId);
    return connection ? decryptProviderConnectionTokens(connection) : null;
  }
  return adminDecryptTokens(row);
}

export async function adminPersistTokens(
  db: Db,
  integrationId: string,
  tokens: Record<string, unknown>,
): Promise<void> {
  const integration = await adminLoadIntegration(db, integrationId);
  if (integration?.providerConnectionId) {
    await adminPersistProviderConnectionTokens(db, integration.providerConnectionId, tokens);
    return;
  }
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

export async function adminPersistProviderConnectionTokens(
  db: Db,
  providerConnectionId: string,
  tokens: Record<string, unknown>,
): Promise<void> {
  const enc = encryptJson(tokens);
  await db
    .update(providerConnections)
    .set({
      authSecretCiphertext: enc.ciphertext,
      authSecretIv: enc.iv,
      authSecretTag: enc.tag,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, providerConnectionId));
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

function attentionTargetConditions(
  input: ResolveConnectionAttentionInput,
  options: { exact?: boolean } = {},
) {
  const conditions = [];
  if (input.providerConnectionId !== undefined || options.exact) {
    conditions.push(
      input.providerConnectionId
        ? eq(connectionAttention.providerConnectionId, input.providerConnectionId)
        : isNull(connectionAttention.providerConnectionId),
    );
  }
  if (input.integrationId !== undefined || options.exact) {
    conditions.push(
      input.integrationId
        ? eq(connectionAttention.integrationId, input.integrationId)
        : isNull(connectionAttention.integrationId),
    );
  }
  if (input.resourceShareId !== undefined || options.exact) {
    conditions.push(
      input.resourceShareId
        ? eq(connectionAttention.resourceShareId, input.resourceShareId)
        : isNull(connectionAttention.resourceShareId),
    );
  }
  return conditions;
}

export async function adminResolveConnectionAttention(
  db: Db,
  teamId: string,
  input: ResolveConnectionAttentionInput,
): Promise<void> {
  const conditions = [
    eq(connectionAttention.teamId, teamId),
    isNull(connectionAttention.resolvedAt),
    ...attentionTargetConditions(input),
  ];
  if (input.categories && input.categories.length > 0) {
    conditions.push(inArray(connectionAttention.category, input.categories));
  }
  await db
    .update(connectionAttention)
    .set({ resolvedAt: new Date(), lastSeenAt: new Date() })
    .where(and(...conditions));
}

export async function adminResetTransientSyncFailures(
  db: Db,
  integrationId: string,
): Promise<void> {
  await adminSaveCursor(
    db,
    integrationId,
    transientSyncResourceType,
    { transient_failure_count: 0 },
    { lastStatus: 'ok', lastError: null },
  );
}

export async function adminRecordTransientSyncFailure(
  db: Db,
  integrationId: string,
  error: string,
): Promise<{ count: number; shouldCreateAttention: boolean }> {
  const cursor = (await adminLoadCursor(db, integrationId, transientSyncResourceType)) as {
    transient_failure_count?: unknown;
  };
  const prior =
    typeof cursor.transient_failure_count === 'number' ? cursor.transient_failure_count : 0;
  const count = prior + 1;
  await adminSaveCursor(
    db,
    integrationId,
    transientSyncResourceType,
    { transient_failure_count: count },
    { lastStatus: 'failed', lastError: error },
  );
  return {
    count,
    shouldCreateAttention: count >= transientSyncAttentionThreshold,
  };
}

export async function adminRecordConnectionAttention(
  db: Db,
  teamId: string,
  input: ConnectionAttentionInput,
): Promise<void> {
  const target: ResolveConnectionAttentionInput = {
    providerConnectionId: input.providerConnectionId,
    integrationId: input.integrationId,
    resourceShareId: input.resourceShareId,
  };
  const conditions = [
    eq(connectionAttention.teamId, teamId),
    eq(connectionAttention.category, input.category),
    isNull(connectionAttention.resolvedAt),
    ...attentionTargetConditions(target, { exact: true }),
  ];
  const existing = await db
    .select({ id: connectionAttention.id, lastEmailedAt: connectionAttention.lastEmailedAt })
    .from(connectionAttention)
    .where(and(...conditions))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    await db
      .update(connectionAttention)
      .set({ summary: input.summary, lastSeenAt: new Date() })
      .where(eq(connectionAttention.id, existingRow.id));
  } else {
    await adminResolveConnectionAttention(db, teamId, {
      ...target,
      categories: connectionAttentionCategoryValues.filter(
        (category) => category !== input.category,
      ),
    });
    const shouldEmail = await shouldEmailConnectionAttention(db, teamId, input);
    const inserted = await db
      .insert(connectionAttention)
      .values({
        teamId,
        providerConnectionId: input.providerConnectionId ?? null,
        integrationId: input.integrationId ?? null,
        resourceShareId: input.resourceShareId ?? null,
        category: input.category,
        summary: input.summary,
      })
      .returning({ id: connectionAttention.id });
    const attentionId = inserted[0]?.id ?? null;
    await notifyConnectionAttentionActors(db, teamId, input, attentionId, shouldEmail);
  }
}

async function notifyConnectionAttentionActors(
  db: Db,
  teamId: string,
  input: ConnectionAttentionInput,
  attentionId: string | null,
  shouldEmail: boolean,
): Promise<void> {
  const recipients = new Set<string>();
  if (
    (input.category === 'needs_reconnect' || input.category === 'access_changed') &&
    input.providerConnectionId
  ) {
    const connection = await adminLoadProviderConnection(db, input.providerConnectionId);
    if (connection) recipients.add(connection.ownerUserId);
  }
  if (input.category === 'needs_new_owner' || input.category === 'sync_error') {
    const admins = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          isNull(teamMembers.removedAt),
          or(eq(teamMembers.role, 'owner'), eq(teamMembers.role, 'admin')),
        ),
      );
    for (const admin of admins) recipients.add(admin.userId);
  }
  if (recipients.size === 0) return;
  await db.insert(notifications).values(
    [...recipients].map((recipient) => ({
      teamId,
      userId: recipient,
      kind: 'connection_attention' as const,
      summary: input.summary,
      payload: {
        category: input.category,
        provider_connection_id: input.providerConnectionId ?? null,
        integration_id: input.integrationId ?? null,
        resource_share_id: input.resourceShareId ?? null,
      },
    })),
  );
  if (shouldEmail) {
    await emailConnectionAttentionActors(db, teamId, input, [...recipients], attentionId);
  }
}

async function shouldEmailConnectionAttention(
  db: Db,
  teamId: string,
  input: ConnectionAttentionInput,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ lastEmailedAt: connectionAttention.lastEmailedAt })
    .from(connectionAttention)
    .where(
      and(
        eq(connectionAttention.teamId, teamId),
        eq(connectionAttention.category, input.category),
        ...attentionTargetConditions(
          {
            providerConnectionId: input.providerConnectionId,
            integrationId: input.integrationId,
            resourceShareId: input.resourceShareId,
          },
          { exact: true },
        ),
      ),
    )
    .orderBy(desc(connectionAttention.lastSeenAt))
    .limit(10);
  return !rows.some((row) => row.lastEmailedAt && row.lastEmailedAt > since);
}

async function emailConnectionAttentionActors(
  db: Db,
  teamId: string,
  input: ConnectionAttentionInput,
  recipientIds: string[],
  attentionId: string | null,
): Promise<void> {
  if (!attentionId || recipientIds.length === 0) return;
  const [teamRow] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const recipients = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.id, recipientIds));
  const actionUrl = `${process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'https://thetimeline.cc'}/app/team/integrations`;
  const results = await Promise.all(
    recipients.map((recipient) =>
      sendConnectionAttentionEmail({
        to: recipient.email,
        teamName: teamRow?.name ?? 'Timeline',
        summary: input.summary,
        actionUrl,
      }),
    ),
  );
  if (results.some((result) => result.ok)) {
    await db
      .update(connectionAttention)
      .set({ lastEmailedAt: new Date() })
      .where(eq(connectionAttention.id, attentionId));
  }
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
