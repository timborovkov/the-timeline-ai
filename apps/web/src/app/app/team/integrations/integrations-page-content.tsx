// Shared page content is kept outside the route module so its test helpers are not route exports.
import { ExternalLink, Plug } from 'lucide-react';
import Link from 'next/link';

import type { IngestWebhookRow } from '@/components/integrations/ingest-webhooks';

import {
  needsAttention,
  type IntegrationsPageModel,
} from '@/app/app/team/integrations/integrations-page-model';
import { ActionChip } from '@/components/action-chip';
import { Breadcrumb } from '@/components/breadcrumb';
import { EmptyState } from '@/components/empty-state';
import { IntegrationsCatalog } from '@/components/integrations/catalog';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { IngestWebhooksUi } from '@/components/integrations/ingest-webhooks';
import { McpCatalog } from '@/components/integrations/mcp-catalog';
import { AddCustomMcpServerLauncher, McpServersUi } from '@/components/integrations/mcp-servers';
import { TeamSourcesUi } from '@/components/integrations/provider-connections';
import { PageHeader } from '@/components/page-header';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { connectionErrorMessage } from '@/lib/ux-errors';

type TeamSourceUiRow = Parameters<typeof TeamSourcesUi>[0]['rows'][number];
type ConnectedIntegrationUiRow = Parameters<typeof ConnectedIntegrations>[0]['connected'][number];
type ConnectedMemberOption = NonNullable<
  Parameters<typeof ConnectedIntegrations>[0]['members']
>[number];
type McpServerUiRow = Parameters<typeof McpServersUi>[0]['servers'][number];

interface IntegrationsPageParams {
  connected?: string;
  error?: string;
  integrationId?: string;
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
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />

      <PageHeader
        variant="collection"
        title="Team integrations"
        subtitle="Manage provider sync, source access, and integration recovery for this team."
        srLabel={`Team integrations · ${String(model.totalConnected)} active syncs · ${String(model.totalCatalog)} providers in catalog`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Active syncs', value: model.totalConnected, mono: true },
          { label: 'Providers', value: model.totalCatalog, mono: true },
        ]}
      />

      <IntegrationPageActions isAdmin={model.isAdmin} />

      <RedirectActionToast
        id="integrations:oauth"
        error={params.error ? connectionErrorMessage(params.error) : null}
        success={params.connected ? 'MCP server connected' : null}
      />

      {model.blockingAttentionCount > 0 ? (
        <div role="alert" className="text-sm text-danger">
          {String(model.blockingAttentionCount)} integration item
          {model.blockingAttentionCount === 1 ? '' : 's'} need attention. Use the affected provider
          below to reconnect credentials, replace the connection, narrow shared sources, or retry
          failed sync.
        </div>
      ) : null}
      {model.webhookDegradedCount > 0 ? (
        <output className="block text-sm text-fg-muted">
          {String(model.webhookDegradedCount)} webhook subscription
          {model.webhookDegradedCount === 1 ? '' : 's'} degraded. Reconciliation remains active
          while provider webhook delivery is repaired.
        </output>
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
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-y border-border py-1.5">
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
        Let external agents read Timeline through member-approved OAuth or a manual team key. This
        is outbound access: external tools reading from Timeline, not Timeline reading from them.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/app/connect-agent">Connect your agent</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/help/agents">Agent install guide</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a
            href="https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex"
            target="_blank"
            rel="noreferrer"
          >
            Plugin source
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </Button>
      </div>
    </section>
  );
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
  hideAttention = false,
}: {
  sourceRows: TeamSourceUiRow[];
  activeShareIds: string[];
  isAdmin: boolean;
  connectedRows: ConnectedIntegrationUiRow[];
  connectedMembers: ConnectedMemberOption[];
  hideAttention?: boolean;
}) {
  const attentionRows = connectedRows.filter(needsAttention);
  const healthyRows = connectedRows.filter((row) => !needsAttention(row));
  const hasSharedSources = sourceRows.length > 0;
  const needsSharedSourceReview = attentionRows.some(needsSharedSourceRecovery);
  const hasActiveImports = connectedRows.length > 0;
  if (!hasSharedSources && !hasActiveImports) return null;

  return (
    <div className="space-y-4">
      {!hideAttention && attentionRows.length > 0 ? (
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
          <EmptyState
            icon={Plug}
            size="inset"
            title="No provider sources are actively syncing"
            body="Shared sources appear here after a team admin activates them for timeline import."
          />
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

function McpCatalogSection({ catalog }: { catalog: IntegrationsPageModel['mcpCatalogAvailable'] }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-fg">MCP servers</h3>
      <p className="text-sm text-fg-muted">
        MCP servers give the agent live tool access. Successful tool results are captured as private
        evidence for reconciliation; passive provider activity still needs native sync or custom
        ingestion.
      </p>
      <McpCatalog
        localConnectionsEnabled={process.env.NODE_ENV !== 'production'}
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
  hideHeading = false,
}: {
  isAdmin: boolean;
  webhooks: IngestWebhookRow[];
  mcpServerRows: McpServerUiRow[];
  mcpCatalog: IntegrationsPageModel['mcpCatalogAvailable'];
  hideHeading?: boolean;
}) {
  const hasContent =
    isAdmin || webhooks.length > 0 || mcpServerRows.length > 0 || mcpCatalog.length > 0;
  if (!hasContent) return null;
  return (
    <section className="space-y-4" aria-labelledby="advanced-integration-tools">
      {hideHeading ? (
        <h3 id="advanced-integration-tools" className="sr-only">
          Agent MCP servers and webhooks
        </h3>
      ) : (
        <>
          <SectionHeading id="advanced-integration-tools">
            Advanced integration tools
          </SectionHeading>
          <p className="max-w-2xl text-sm text-fg-muted">
            Use these for agent tool access, custom ingestion, and operator-level recovery. Native
            provider sync stays above.
          </p>
        </>
      )}
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
    <EmptyState
      icon={Plug}
      title="No sources connected yet"
      body="Connect a native provider to sync work into the timeline, or add an MCP-compatible server for live agent tool access."
    >
      {isAdmin ? (
        <Button asChild variant="outline" size="sm">
          <Link href="https://github.com/timborovkov/the-timeline-ai/blob/main/docs/setup/integrations.md">
            Read the setup guide
          </Link>
        </Button>
      ) : (
        <p className="text-sm text-fg-muted">Ask a team admin to enable a source to get started.</p>
      )}
    </EmptyState>
  );
}
