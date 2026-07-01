import { ingestWebhookCredentials, ingestWebhooks, users } from '@timeline/db';
import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { IngestWebhookRow } from '@/components/integrations/ingest-webhooks';
import type { Metadata } from 'next';

import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { IngestWebhooksUi } from '@/components/integrations/ingest-webhooks';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';
import { TeamSourcesUi } from '@/components/integrations/provider-connections';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { connectionErrorMessage } from '@/lib/ux-errors';

export const metadata: Metadata = {
  title: 'Team integrations',
  description: 'Manage provider sync, source access, and integration recovery for this team.',
};

export const dynamic = 'force-dynamic';

type TeamSourceUiRow = Parameters<typeof TeamSourcesUi>[0]['rows'][number];
type ConnectedIntegrationUiRow = Parameters<typeof ConnectedIntegrations>[0]['connected'][number];
type ConnectedIntegrationAttention = ConnectedIntegrationUiRow['attention'][number];
type ConnectedIntegrationSyncPause = NonNullable<ConnectedIntegrationUiRow['syncPause']>;
type ConnectedMemberOption = NonNullable<
  Parameters<typeof ConnectedIntegrations>[0]['members']
>[number];
type McpServerUiRow = Parameters<typeof McpServersUi>[0]['servers'][number];
type IntegrationsPageModel = Awaited<ReturnType<typeof loadIntegrationsPageModel>>;

interface IntegrationsPageParams {
  connected?: string;
  error?: string;
  integrationId?: string;
}

function isBlockingConnectionAttention(category: ConnectedIntegrationAttention['category']) {
  return category !== 'webhook_degraded';
}

export function visibleConnectionAttentionStats(connectedRows: ConnectedIntegrationUiRow[]) {
  const visibleAttention = new Map<string, ConnectedIntegrationAttention>();
  for (const row of connectedRows) {
    for (const item of row.attention) {
      visibleAttention.set(item.id, item);
    }
  }
  const attention = [...visibleAttention.values()];
  const blockingAttentionCount = attention.filter((item) =>
    isBlockingConnectionAttention(item.category),
  ).length;
  return {
    blockingAttentionCount,
    webhookDegradedCount: attention.length - blockingAttentionCount,
  };
}

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

async function loadIntegrationsPageModel(input: { teamId: string; userId: string }) {
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
  const [selectionLists, syncPauseEntries] = await Promise.all([
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
  const connectedRows: ConnectedIntegrationUiRow[] = connected.map((c) => ({
    id: c.id,
    provider: c.provider,
    displayName: c.displayName,
    enabled: c.enabled,
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
    lastError: c.lastError,
    syncPause: syncPauseByIntegrationId.get(c.id) ?? null,
    attention: attentionByIntegrationId.get(c.id) ?? [],
    visibilityDefault: c.visibilityDefault,
    visibilityDefaultUserIds: c.visibilityDefaultUserIds,
  }));
  const connectedMembers: ConnectedMemberOption[] = members.map((m) => {
    const u = memberUserMap.get(m.userId);
    return { id: m.userId, label: u?.name ?? u?.email ?? m.userId };
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

/**
 * Single integrations page. Sits under /app/team. The layout is:
 *   1. Breadcrumb  (Team / Integrations)
 *   2. PageHeader (title + metadata strip)
 *   3. Secondary navigation chips
 *   4. Recovery-first native integration workflow
 *   5. Native provider catalog
 *   6. Advanced tools for MCP, webhooks, audit, and job recovery
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; integrationId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const [params, model] = await Promise.all([
    searchParams,
    loadIntegrationsPageModel({
      teamId: active.teamId,
      userId: session.user.id,
    }),
  ]);

  return <IntegrationsPageView params={params} active={active} model={model} />;
}

export function IntegrationsPageView({
  params,
  active,
  model,
}: {
  params: IntegrationsPageParams;
  active: { teamName: string };
  model: IntegrationsPageModel;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />

      <PageHeader
        title="Team integrations"
        subtitle="Manage provider sync, source access, and integration recovery for this team."
        srLabel={`Team integrations · ${String(model.totalConnected)} active syncs · ${String(model.totalCatalog)} providers in catalog`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'active syncs', value: model.totalConnected },
          { label: 'providers', value: model.totalCatalog },
        ]}
      />

      <IntegrationPageActions isAdmin={model.isAdmin} />

      {params.connected ? (
        <div className="rounded-sm border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          MCP server connected successfully. It should now appear under Advanced integration tools.
        </div>
      ) : null}
      {params.error ? (
        <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <p>{connectionErrorMessage(params.error)}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-fg-dim">Error details</summary>
            <code className="mt-1 block text-xs">{params.error}</code>
          </details>
        </div>
      ) : null}

      {model.blockingAttentionCount > 0 ? (
        <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(model.blockingAttentionCount)} integration item
          {model.blockingAttentionCount === 1 ? '' : 's'} need attention. Use the affected provider
          below to reconnect credentials, replace the connection, narrow shared sources, or retry
          failed sync.
        </div>
      ) : null}
      {model.webhookDegradedCount > 0 ? (
        <div className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-sm text-fg">
          {String(model.webhookDegradedCount)} webhook subscription
          {model.webhookDegradedCount === 1 ? '' : 's'} degraded. Reconciliation remains active
          while provider webhook delivery is repaired.
        </div>
      ) : null}

      <IntegrationWorkflow
        sourceRows={model.teamSourceRows}
        activeShareIds={model.activeShareIds}
        isAdmin={model.isAdmin}
        connectedRows={model.connectedRows}
        connectedMembers={model.connectedMembers}
      />

      {model.nativeCatalog.length > 0 ? (
        <NativeIntegrationsSection catalog={model.nativeCatalog} />
      ) : null}

      <AdvancedIntegrationSection
        isAdmin={model.isAdmin}
        webhooks={model.ingestWebhookList}
        mcpServerRows={model.mcpServerRows}
        mcpCatalog={model.mcpCatalogAvailable}
      />

      {!model.hasAnything ? <NoSourcesState isAdmin={model.isAdmin} /> : null}
    </div>
  );
}

function IntegrationPageActions({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
      <ActionChip href="/app/me/connections" label="Provider accounts →" />
      <ActionChip href="/app/team/integrations/audit" label="Audit log →" />
      {isAdmin ? <ActionChip href="/app/team/jobs" label="Job recovery →" /> : null}
      <ActionChip href="/app/me/mcp-servers" label="Personal MCP →" />
    </div>
  );
}

function McpEndpointSection() {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-fg">Expose Timeline as an MCP server</h3>
      <p className="max-w-2xl text-sm text-fg-muted">
        Let external agents read this team&apos;s timeline events through a bearer-keyed MCP
        endpoint. This is outbound access: external tools reading from Timeline, not Timeline
        reading from them.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/app/team/mcp-share">Manage MCP endpoint</Link>
      </Button>
    </section>
  );
}

function needsAttention(row: ConnectedIntegrationUiRow) {
  return row.attention.length > 0 || Boolean(row.lastError);
}

function needsSharedSourceRecovery(row: ConnectedIntegrationUiRow) {
  return (
    row.attention.some(
      (item) => item.category === 'needs_new_owner' || item.category === 'access_changed',
    ) ||
    (row.lastError?.includes('Provider connection deleted') ?? false)
  );
}

function IntegrationWorkflow({
  sourceRows,
  activeShareIds,
  isAdmin,
  connectedRows,
  connectedMembers,
}: {
  sourceRows: TeamSourceUiRow[];
  activeShareIds: string[];
  isAdmin: boolean;
  connectedRows: ConnectedIntegrationUiRow[];
  connectedMembers: ConnectedMemberOption[];
}) {
  const attentionRows = connectedRows.filter(needsAttention);
  const healthyRows = connectedRows.filter((row) => !needsAttention(row));
  const hasSharedSources = sourceRows.length > 0;
  const needsSharedSourceReview = attentionRows.some(needsSharedSourceRecovery);
  const hasActiveImports = connectedRows.length > 0;
  if (!hasSharedSources && !hasActiveImports) return null;

  return (
    <div className="space-y-8">
      {attentionRows.length > 0 ? (
        <section className="space-y-3" aria-labelledby="integration-needs-attention">
          <SectionHeading id="integration-needs-attention">Needs attention</SectionHeading>
          <p className="max-w-2xl text-sm text-fg-muted">
            Fix broken credentials, revoked access, or failed syncs before looking at healthy
            imports.
          </p>
          <ConnectedIntegrations connected={attentionRows} members={connectedMembers} />
        </section>
      ) : null}
      {healthyRows.length > 0 ? (
        <section className="space-y-3" aria-labelledby="active-team-sync">
          <SectionHeading id="active-team-sync">Active team sync</SectionHeading>
          <p className="max-w-2xl text-sm text-fg-muted">
            These imports are currently writing cited evidence into the timeline.
          </p>
          <ConnectedIntegrations connected={healthyRows} members={connectedMembers} />
        </section>
      ) : hasActiveImports ? null : (
        <section className="space-y-3" aria-labelledby="active-team-sync">
          <SectionHeading id="active-team-sync">Active team sync</SectionHeading>
          <p className="rounded-sm border border-dashed border-border bg-surface p-4 text-sm text-fg-muted">
            No provider sources are actively syncing yet.
          </p>
        </section>
      )}
      {hasSharedSources || needsSharedSourceReview ? (
        <section className="space-y-3" aria-labelledby="available-shared-sources">
          <SectionHeading id="available-shared-sources">Available shared sources</SectionHeading>
          <p className="max-w-2xl text-sm text-fg-muted">
            Choose which provider-account sources should become active team imports.
          </p>
          <TeamSourcesUi rows={sourceRows} activeShareIds={activeShareIds} isAdmin={isAdmin} />
        </section>
      ) : null}
    </div>
  );
}

function NativeIntegrationsSection({
  catalog,
}: {
  catalog: Parameters<typeof IntegrationsCatalog>[0]['catalog'];
}) {
  return (
    <section className="space-y-3">
      <SectionHeading>Connect provider account</SectionHeading>
      <p className="text-sm text-fg-muted">
        Connect your own provider account first. After OAuth, choose which sources this team may
        use, then return here to activate team sync.
      </p>
      <IntegrationsCatalog catalog={catalog} />
    </section>
  );
}

function IngestWebhookSection({ webhooks }: { webhooks: IngestWebhookRow[] }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-fg">Ingest webhooks</h3>
      <IngestWebhooksUi webhooks={webhooks} />
    </section>
  );
}

function McpCatalogSection({
  catalog,
}: {
  catalog: ReturnType<typeof integrationsLib.listCatalog>;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-fg">MCP servers</h3>
      <p className="text-sm text-fg-muted">
        MCP servers give the agent live tool access. They do not create timeline events unless
        paired with native sync or custom ingestion.
      </p>
      <McpCatalog
        entries={catalog.map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          logo: c.logo,
          category: c.category,
          authType: c.mcpAuthType ?? null,
          authHint: c.mcpAuthHint ?? null,
          status: c.status,
          ingestStatus: c.ingestStatus,
        }))}
      />
    </section>
  );
}

function AdvancedIntegrationSection({
  isAdmin,
  webhooks,
  mcpServerRows,
  mcpCatalog,
}: {
  isAdmin: boolean;
  webhooks: IngestWebhookRow[];
  mcpServerRows: McpServerUiRow[];
  mcpCatalog: ReturnType<typeof integrationsLib.listCatalog>;
}) {
  const hasContent =
    isAdmin || webhooks.length > 0 || mcpServerRows.length > 0 || mcpCatalog.length > 0;
  if (!hasContent) return null;
  return (
    <section className="space-y-4" aria-labelledby="advanced-integration-tools">
      <SectionHeading id="advanced-integration-tools">Advanced integration tools</SectionHeading>
      <p className="max-w-2xl text-sm text-fg-muted">
        Use these for agent tool access, custom ingestion, and operator-level recovery. Native
        provider sync stays above.
      </p>
      {isAdmin ? (
        <div className="space-y-2">
          <AddCustomMcpServerLauncher ownership="team" />
        </div>
      ) : null}
      <div className="space-y-5 border-y border-border py-5">
        {isAdmin ? <McpEndpointSection /> : null}
        {mcpServerRows.length > 0 ? <McpServersUi hideAddButton servers={mcpServerRows} /> : null}
        {isAdmin ? <IngestWebhookSection webhooks={webhooks} /> : null}
        {mcpCatalog.length > 0 ? <McpCatalogSection catalog={mcpCatalog} /> : null}
      </div>
    </section>
  );
}

function NoSourcesState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-sm border border-dashed border-border bg-surface p-6 text-sm text-fg-muted">
      <p className="mb-1 font-medium text-fg">No sources connected yet.</p>
      <p>
        Connect a native provider to sync work into the timeline, or add an MCP-compatible server
        for live agent tool access.
      </p>
      {isAdmin ? (
        <p className="mt-2">
          <Link className="text-signal underline" href="/docs/setup/integrations.html">
            Read the setup guide
          </Link>
        </p>
      ) : (
        <p className="mt-2">Ask a team admin to enable a source to get started.</p>
      )}
    </div>
  );
}
