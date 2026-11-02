import { ingestWebhookCredentials, ingestWebhooks, users } from '@timeline/db';
import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { ConnectedIntegrations } from '@/components/integrations/connected';
import type { IngestWebhookRow } from '@/components/integrations/ingest-webhooks';
import type { McpServersUi } from '@/components/integrations/mcp-servers';
import type { TeamSourcesUi } from '@/components/integrations/provider-connections';

import { visibleConnectionAttentionStats } from '@/app/app/team/integrations/connection-attention';
import { db } from '@/lib/db';
import { displayMemberLabel } from '@/lib/display-labels';

type TeamSourceUiRow = Parameters<typeof TeamSourcesUi>[0]['rows'][number];
type ConnectedIntegrationUiRow = Parameters<typeof ConnectedIntegrations>[0]['connected'][number];
type ConnectedIntegrationAttention = ConnectedIntegrationUiRow['attention'][number];
type ConnectedIntegrationSyncPause = NonNullable<ConnectedIntegrationUiRow['syncPause']>;
type ConnectedMemberOption = NonNullable<
  Parameters<typeof ConnectedIntegrations>[0]['members']
>[number];
type McpServerUiRow = Parameters<typeof McpServersUi>[0]['servers'][number];

export type IntegrationsPageModel = Awaited<ReturnType<typeof loadIntegrationsPageModel>>;

function ingestWebhookListFromRows(
  rows: {
    webhook: typeof ingestWebhooks.$inferSelect;
    credential: typeof ingestWebhookCredentials.$inferSelect | null;
  }[],
): IngestWebhookRow[] {
  const webhookMap = new Map<string, IngestWebhookRow>();
  for (const row of rows) {
    const webhookId = row.webhook.id;
    const existing = webhookMap.get(webhookId) ?? {
      id: webhookId,
      name: row.webhook.name,
      visibilityDefault: row.webhook.visibilityDefault,
      eventClass: row.webhook.eventClass,
      proposalGenerationEnabled: row.webhook.proposalGenerationEnabled,
      disabledAt: row.webhook.disabledAt ? row.webhook.disabledAt.toISOString() : null,
      createdAt: row.webhook.createdAt.toISOString(),
      credentials: [],
    };
    if (row.credential) {
      existing.credentials.push({
        id: row.credential.id,
        prefix: row.credential.keyPrefix,
        lastUsedAt: row.credential.lastUsedAt ? row.credential.lastUsedAt.toISOString() : null,
        createdAt: row.credential.createdAt.toISOString(),
      });
    }
    webhookMap.set(webhookId, existing);
  }
  return Array.from(webhookMap.values());
}

export function needsAttention(row: ConnectedIntegrationUiRow) {
  return row.attention.length > 0 || Boolean(row.lastError) || Boolean(row.healthPause);
}

export async function loadIntegrationsPageModel(input: { teamId: string; userId: string }) {
  const scope = withTeam(db, input.teamId, input.userId);
  const [role, connected, mcpServers, members, resourceShares, attention, ingestWebhookRows] =
    await Promise.all([
      scope.requireMembership(),
      scope.integrations.listIntegrations(),
      scope.mcp.listTeamServers(),
      scope.timeline.listMembers(),
      scope.integrations.listTeamResourceShares(),
      scope.integrations.listConnectionAttention(),
      db
        .select({ webhook: ingestWebhooks, credential: ingestWebhookCredentials })
        .from(ingestWebhooks)
        .leftJoin(
          ingestWebhookCredentials,
          and(
            eq(ingestWebhookCredentials.webhookId, ingestWebhooks.id),
            isNull(ingestWebhookCredentials.revokedAt),
          ),
        )
        .where(eq(ingestWebhooks.teamId, input.teamId))
        .orderBy(desc(ingestWebhooks.createdAt), desc(ingestWebhookCredentials.createdAt)),
    ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const ownerIds = resourceShares.map((row) => row.connection.ownerUserId);
  const userIds = [...new Set([...members.map((m) => m.userId), ...ownerIds])];
  const memberUsers =
    userIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const memberUserMap = new Map(memberUsers.map((u) => [u.id, u] as const));
  const nativeCatalog = integrationsLib.listAvailableProviders();
  const mcpCatalog = integrationsLib.listCatalog().filter((c) => c.kind === 'mcp');
  const ingestWebhookList = ingestWebhookListFromRows(ingestWebhookRows);
  const connectedUrls = new Set(mcpServers.map((s) => s.url));
  const mcpCatalogAvailable = mcpCatalog.filter((c) => !c.mcpUrl || !connectedUrls.has(c.mcpUrl));
  const [selectionLists, syncPauseEntries, recoveryStates] = await Promise.all([
    Promise.all(
      connected.map(async (integration) => scope.integrations.listSelections(integration.id)),
    ),
    Promise.all(
      connected.map(
        async (integration): Promise<readonly [string, ConnectedIntegrationSyncPause | null]> => {
          const integrationPause = await integrationsLib.adminLoadIntegrationSyncPause(
            db,
            integration.id,
          );
          if (integrationPause) {
            return [
              integration.id,
              {
                retryAt: integrationPause.retryAt.toISOString(),
                reason: integrationPause.reason,
                scope: null,
              },
            ] as const;
          }
          const budgetKey = integrationsLib.providerBudgetKeyForIntegration(integration);
          const providerPause = budgetKey
            ? await integrationsLib.adminLoadProviderBudgetPause(db, budgetKey)
            : null;
          return [
            integration.id,
            providerPause
              ? {
                  retryAt: providerPause.retryAt.toISOString(),
                  reason: providerPause.reason,
                  scope: providerPause.scope,
                }
              : null,
          ] as const;
        },
      ),
    ),
    Promise.all(
      connected.map(async (integration) => scope.integrations.listSyncState(integration.id)),
    ),
  ]);
  const syncPauseByIntegrationId = new Map(syncPauseEntries);
  const selectionsByIntegrationId = new Map(
    connected.map((integration, index) => [integration.id, selectionLists[index] ?? []] as const),
  );
  const attentionByIntegrationId = new Map<string, ConnectedIntegrationAttention[]>();
  for (const integration of connected) {
    const selections = selectionsByIntegrationId.get(integration.id) ?? [];
    const selectionShareIds = new Set(
      selections.flatMap((selection) =>
        selection.resourceShareId ? [selection.resourceShareId] : [],
      ),
    );
    const rowAttention = attention.filter((item) => {
      if (item.integrationId === integration.id) return true;
      if (
        item.providerConnectionId &&
        item.providerConnectionId === integration.providerConnectionId
      ) {
        return true;
      }
      if (item.resourceShareId && selectionShareIds.has(item.resourceShareId)) return true;
      return false;
    });
    attentionByIntegrationId.set(
      integration.id,
      rowAttention.map((item) => ({
        id: item.id,
        category: item.category,
        summary: item.summary,
        lastSeenAt: item.lastSeenAt.toISOString(),
      })),
    );
  }
  const activeShareIds = selectionLists
    .flat()
    .flatMap((selection) => (selection.resourceShareId ? [selection.resourceShareId] : []));
  const teamSourceRows: TeamSourceUiRow[] = resourceShares.map((row) => ({
    share: {
      id: row.share.id,
      providerConnectionId: row.share.providerConnectionId,
      resourceKind: row.share.resourceKind,
      externalId: row.share.externalId,
      externalLabel: row.share.externalLabel,
      revokedAt: row.share.revokedAt ? row.share.revokedAt.toISOString() : null,
    },
    connection: {
      id: row.connection.id,
      provider: row.connection.provider,
      displayName: row.connection.displayName,
      ownerUserId: row.connection.ownerUserId,
      ownerLabel:
        memberUserMap.get(row.connection.ownerUserId)?.name ??
        memberUserMap.get(row.connection.ownerUserId)?.email ??
        row.connection.ownerUserId,
      lastError: row.connection.lastError,
      lastConnectedAt: row.connection.lastConnectedAt.toISOString(),
    },
  }));
  const connectedRows: ConnectedIntegrationUiRow[] = connected.map((c, index) => ({
    id: c.id,
    setupRequired:
      c.provider === 'slack' &&
      !(recoveryStates[index] ?? []).some(
        (state) =>
          state.resourceType === 'slack.webhook' &&
          Boolean((state.cursor as Record<string, unknown>).verified_at),
      ),
    pendingSync:
      !c.lastSyncedAt ||
      (recoveryStates[index] ?? []).some((state) => {
        const cursor = state.cursor as Record<string, unknown>;
        return [
          cursor.after,
          cursor.page,
          cursor.history_page,
          Array.isArray(cursor.pending_threads) && cursor.pending_threads.length,
        ].some(Boolean);
      }),
    provider: c.provider,
    displayName: c.displayName,
    enabled: c.enabled,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
    lastError: c.lastError,
    syncPause: syncPauseByIntegrationId.get(c.id) ?? null,
    healthPause:
      c.healthPausedAt && integrationsLib.isIntegrationHealthPauseKind(c.healthPauseKind)
        ? {
            kind: c.healthPauseKind,
            pausedAt: c.healthPausedAt.toISOString(),
            firstFailedAt: c.healthFirstFailedAt ? c.healthFirstFailedAt.toISOString() : null,
          }
        : null,
    attention: attentionByIntegrationId.get(c.id) ?? [],
    visibilityDefault: c.visibilityDefault,
    visibilityDefaultUserIds: c.visibilityDefaultUserIds,
  }));
  const connectedMembers: ConnectedMemberOption[] = members.map((m) => {
    const u = memberUserMap.get(m.userId);
    return { id: m.userId, label: displayMemberLabel(u) };
  });
  const mcpServerRows: McpServerUiRow[] = mcpServers.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    authType: s.authType,
    enabled: s.enabled,
    cachedTools: Array.isArray(s.cachedTools)
      ? (s.cachedTools as { name: string; description?: string }[])
      : [],
    disabledTools: Array.isArray(s.disabledTools) ? (s.disabledTools as string[]) : [],
    toolsCachedAt: s.toolsCachedAt ? s.toolsCachedAt.toISOString() : null,
    lastError: s.lastError,
  }));
  const totalConnected = connected.length + mcpServers.length;
  const totalCatalog = nativeCatalog.length + mcpCatalogAvailable.length;
  const totalSharedSources = resourceShares.length;
  const { blockingAttentionCount, webhookDegradedCount } =
    visibleConnectionAttentionStats(connectedRows);

  return {
    isAdmin,
    blockingAttentionCount,
    webhookDegradedCount,
    totalConnected,
    totalCatalog,
    totalSharedSources,
    hasAnything:
      totalConnected > 0 ||
      totalCatalog > 0 ||
      totalSharedSources > 0 ||
      ingestWebhookList.length > 0,
    nativeCatalog,
    mcpCatalogAvailable,
    ingestWebhookList,
    activeShareIds,
    teamSourceRows,
    connectedRows,
    connectedMembers,
    mcpServerRows,
  };
}
