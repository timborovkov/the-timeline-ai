import { withTeam } from '@timeline/shared/team-scope';
import { Bot, FileText, Mail, Plug, Send, Video, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import {
  AdvancedIntegrationSection,
  IntegrationWorkflow,
} from '@/app/app/team/integrations/integrations-page-content';
import {
  loadIntegrationsPageModel,
  needsAttention,
  type IntegrationsPageModel,
} from '@/app/app/team/integrations/integrations-page-model';
import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { ConnectedIntegrations } from '@/components/integrations/connected';
import { NativeProviderConnectButton } from '@/components/native-provider-connect-button';
import { PageHeader } from '@/components/page-header';
import { ProviderLogo } from '@/components/provider-logo';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { SectionHeading } from '@/components/section-heading';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { CONNECTIONS_HREF } from '@/lib/connections';
import { db } from '@/lib/db';
import { getSourcesStatusSummary, type SourcesStatusSummary } from '@/lib/hub-status';
import { connectionErrorMessage } from '@/lib/ux-errors';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Capture and integration surfaces that feed the timeline.',
};

type SourceStatus = 'connected' | 'attention' | 'not-setup';

const CAPTURE_LABELS = new Set(['Email', 'Telegram']);
const ADVANCED_LABELS = new Set(['MCP servers']);

interface SourceEntry {
  rowId?: string;
  href: string;
  label: string;
  description: string;
  icon?: LucideIcon;
  logoSrc?: string;
  status: SourceStatus;
  statusLabel: string;
  actionHref?: string;
  actionLabel?: string;
  connectProviderId?: string;
  connectLabel?: string;
  connectDisabled?: boolean;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
  detail: string;
  copyValue?: string;
  note?: string;
}

interface SourcesPageParams {
  connected?: string;
  error?: string;
  integrationId?: string;
}

function nativeProviderEntries(
  summary: SourcesStatusSummary,
  model: IntegrationsPageModel,
): SourceEntry[] {
  return model.nativeCatalog.map((provider) => {
    const providerRows = model.connectedRows.filter((row) => row.provider === provider.id);
    const providerAttention = providerRows.some((row) => needsAttention(row));
    const slackCapture = provider.id === 'slack' && summary.slackConnections > 0;
    const connected = providerRows.length > 0 || slackCapture;
    const status: SourceStatus = providerAttention
      ? 'attention'
      : connected
        ? 'connected'
        : 'not-setup';
    const statusLabel = providerAttention
      ? `${providerRows.filter((row) => needsAttention(row)).length} need reconnect`
      : connected
        ? 'Connected'
        : provider.available
          ? 'Not set up'
          : 'Setup required';
    const syncDetail =
      providerRows.length > 0
        ? `${providerRows.length} team sync${providerRows.length === 1 ? '' : 's'}`
        : null;
    const captureDetail = slackCapture
      ? `${summary.slackConnections} chat link${summary.slackConnections === 1 ? '' : 's'}`
      : null;
    return {
      rowId: provider.id,
      href: `${CONNECTIONS_HREF}#${provider.id}`,
      label: provider.label,
      description: provider.description,
      logoSrc: provider.logo,
      status,
      statusLabel,
      connectProviderId: provider.id,
      connectLabel: 'Connect',
      connectDisabled: !provider.available,
      secondaryActionHref:
        provider.id === 'slack'
          ? '/app/team/slack'
          : providerRows.length > 0
            ? '/app/me/connections'
            : undefined,
      secondaryActionLabel:
        provider.id === 'slack' ? 'Chat capture' : providerRows.length > 0 ? 'Manage' : undefined,
      detail:
        syncDetail && captureDetail
          ? `${syncDetail} · ${captureDetail}`
          : (syncDetail ??
            captureDetail ??
            (provider.available ? 'Personal account first' : 'Setup required')),
    };
  });
}

function buildSources(
  summary: SourcesStatusSummary,
  isAdmin: boolean,
  model: IntegrationsPageModel,
): SourceEntry[] {
  const emailConnected = Boolean(summary.inboundEmail);
  const emailForwarded = summary.emailForwarded;
  const email: SourceEntry = {
    href: CONNECTIONS_HREF,
    label: 'Email',
    description: 'Forward, CC, or BCC team mail into the archive.',
    icon: Mail,
    status: emailForwarded ? 'connected' : emailConnected ? 'attention' : 'not-setup',
    statusLabel: emailForwarded
      ? 'Connected'
      : emailConnected
        ? 'Ready, no mail yet'
        : 'Not set up',
    actionHref: '/app/team?section=email',
    actionLabel: emailConnected ? 'Manage email' : 'Set up email',
    detail: summary.inboundEmail ?? 'No inbound address configured',
    copyValue: summary.inboundEmail ?? undefined,
    note: emailConnected
      ? 'Member email addresses are attributed automatically. Unknown senders are captured and marked unverified.'
      : undefined,
  };

  const telegramConnected = summary.telegramConnections > 0;
  const telegram: SourceEntry = {
    href: '/app/team/telegram',
    label: 'Telegram',
    description: 'Route chat and voice notes into the same capture pipeline.',
    icon: Send,
    status: telegramConnected ? 'connected' : 'not-setup',
    statusLabel: telegramConnected ? 'Connected' : 'Not set up',
    actionHref: '/app/team/telegram',
    actionLabel: telegramConnected ? 'Manage' : 'Link Telegram',
    detail: telegramConnected
      ? `${summary.telegramConnections} link${summary.telegramConnections === 1 ? '' : 's'}`
      : 'No Telegram chats linked',
  };

  const docsConnected = summary.documentsTotal > 0;
  const docs: SourceEntry = {
    href: '/app/documents',
    label: 'Documents',
    description: 'Upload source material the agent can search, cite, and version.',
    icon: FileText,
    status: summary.documentAttention > 0 ? 'attention' : docsConnected ? 'connected' : 'not-setup',
    statusLabel:
      summary.documentAttention > 0
        ? `${summary.documentAttention} need attention`
        : docsConnected
          ? 'Connected'
          : 'Not set up',
    actionHref: '/app/documents',
    actionLabel:
      summary.documentAttention > 0 ? 'Review issues' : docsConnected ? 'Manage' : 'Upload',
    detail: docsConnected
      ? `${summary.documentsTotal} file${summary.documentsTotal === 1 ? '' : 's'}`
      : 'No documents uploaded yet',
  };

  const meetingsAny = summary.meetingsRecent > 0;
  const meetings: SourceEntry = {
    href: '/app/meetings',
    label: 'Meetings',
    description: 'Invite silent notetakers for transcript capture from live calls.',
    icon: Video,
    status: summary.meetingsFailed > 0 ? 'attention' : meetingsAny ? 'connected' : 'not-setup',
    statusLabel:
      summary.meetingsFailed > 0
        ? `${summary.meetingsFailed} failed`
        : meetingsAny
          ? 'Connected'
          : 'Not set up',
    actionHref:
      isAdmin && summary.meetingsFailed > 0
        ? '/app/team/jobs?kind=meeting_finalization'
        : '/app/meetings',
    actionLabel:
      isAdmin && summary.meetingsFailed > 0
        ? 'Review failures'
        : meetingsAny
          ? 'Manage'
          : 'Invite notetaker',
    secondaryActionHref: summary.meetingsFailed > 0 ? '/app/meetings' : undefined,
    secondaryActionLabel: summary.meetingsFailed > 0 ? 'Open meetings' : undefined,
    detail: meetingsAny ? `${summary.meetingsRecent} recent` : 'No meetings captured yet',
  };

  const mcpAny = summary.mcpServers > 0;
  const mcp: SourceEntry = {
    href: '#advanced-integration-tools',
    label: 'MCP servers',
    description: 'Attach custom external tools for live agent access.',
    icon: Bot,
    status: summary.mcpErrors > 0 ? 'attention' : mcpAny ? 'connected' : 'not-setup',
    statusLabel:
      summary.mcpErrors > 0
        ? `${summary.mcpErrors} need attention`
        : mcpAny
          ? 'Connected'
          : 'Not set up',
    actionHref: '#advanced-integration-tools',
    actionLabel: summary.mcpErrors > 0 ? 'Review issues' : mcpAny ? 'Manage' : 'Add server',
    detail: mcpAny
      ? `${summary.mcpServers} server${summary.mcpServers === 1 ? '' : 's'}`
      : 'No MCP servers added',
  };

  return [meetings, docs, ...nativeProviderEntries(summary, model), email, telegram, mcp];
}

function sourceDoesNotNeedAttention(source: SourceEntry): boolean {
  return source.status !== 'attention';
}

function isCaptureSource(source: SourceEntry): boolean {
  return CAPTURE_LABELS.has(source.label);
}

function isAdvancedSource(source: SourceEntry): boolean {
  return ADVANCED_LABELS.has(source.label);
}

function isDirectorySource(source: SourceEntry): boolean {
  return !isCaptureSource(source) && !isAdvancedSource(source);
}

function partitionConnectionSources(sources: SourceEntry[]) {
  const attentionSources = sources.filter((source) => source.status === 'attention');
  const connectedSources = sources.filter((source) => source.status === 'connected');
  const notSetupSources = sources.filter((source) => source.status === 'not-setup');
  return {
    attentionSources,
    connectedCount: connectedSources.length,
    notSetupCount: notSetupSources.length,
    connectedProviders: connectedSources.filter(isDirectorySource),
    addable: notSetupSources.filter(isDirectorySource),
    captureSources: sources.filter(
      (source) => isCaptureSource(source) && sourceDoesNotNeedAttention(source),
    ),
    advancedSources: sources.filter(isAdvancedSource),
  };
}

function connectionHeaderMetadata(
  teamName: string,
  connectedCount: number,
  attentionCount: number,
  notSetupCount: number,
) {
  return [
    { label: 'Team', value: teamName },
    { label: 'Connected', value: connectedCount, mono: true },
    ...(attentionCount > 0
      ? ([{ label: 'Attention', value: attentionCount, mono: true, danger: true }] as const)
      : ([] as const)),
    ...(notSetupCount > 0
      ? ([{ label: 'Not set up', value: notSetupCount, mono: true }] as const)
      : ([] as const)),
  ];
}

function ConnectionHealthNotices({ model }: { model: IntegrationsPageModel }) {
  return (
    <>
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
    </>
  );
}

function NeedsAttentionSection({
  sources,
  rows,
  members,
}: {
  sources: SourceEntry[];
  rows: IntegrationsPageModel['connectedRows'];
  members: IntegrationsPageModel['connectedMembers'];
}) {
  if (sources.length === 0 && rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Needs attention">
      {sources.length > 0 ? (
        <SourceGroup title="Needs attention" sources={sources} />
      ) : (
        <SectionHeading id="connections-needs-attention">Needs attention</SectionHeading>
      )}
      {rows.length > 0 ? <ConnectedIntegrations connected={rows} members={members} /> : null}
    </section>
  );
}

function AdvancedToolsSection({ sources, isAdmin }: { sources: SourceEntry[]; isAdmin: boolean }) {
  return (
    <section className="space-y-3">
      <CollectionGroup count={sources.length} title="Advanced tools">
        {sources.map((source) => (
          <SourceRow key={source.label} source={source} />
        ))}
        <div className="flex flex-wrap gap-2 px-3 py-2 text-sm">
          <Link
            href="/app/me/connections"
            className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Provider accounts
          </Link>
          <Link
            href="/app/me/mcp-servers"
            className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Personal MCP
          </Link>
          {isAdmin ? (
            <>
              <Link
                href="/app/team/mcp-share"
                className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                Outbound MCP sharing
              </Link>
              <Link
                href="/app/team/integrations/audit"
                className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                Integration audit
              </Link>
              <Link
                href="/app/team/jobs"
                className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                Job recovery
              </Link>
            </>
          ) : null}
        </div>
      </CollectionGroup>
    </section>
  );
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<SourcesPageParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const [params, role, summary, model] = await Promise.all([
    searchParams,
    scope.requireMembership(),
    getSourcesStatusSummary(scope),
    loadIntegrationsPageModel({
      teamId: active.teamId,
      userId: session.user.id,
    }),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  return (
    <SourcesPageView
      params={params}
      active={active}
      isAdmin={isAdmin}
      summary={summary}
      model={model}
    />
  );
}

export function SourcesPageView({
  params,
  active,
  isAdmin,
  summary,
  model,
}: {
  params: SourcesPageParams;
  active: { teamName: string };
  isAdmin: boolean;
  summary: SourcesStatusSummary;
  model: IntegrationsPageModel;
}) {
  const sources = buildSources(summary, isAdmin, model);
  const groups = partitionConnectionSources(sources);
  const attentionCount = summary.attention;
  const attentionRows = model.connectedRows.filter((row) => needsAttention(row));

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Connections"
        subtitle="Capture surfaces, native sync, and live external tools."
        srLabel={`Connections · ${active.teamName} · ${groups.connectedCount} connected · ${attentionCount} need attention · ${groups.notSetupCount} not set up`}
        metadata={connectionHeaderMetadata(
          active.teamName,
          groups.connectedCount,
          attentionCount,
          groups.notSetupCount,
        )}
      />

      <RedirectActionToast
        id="integrations:oauth"
        error={params.error ? connectionErrorMessage(params.error) : null}
        success={params.connected ? 'MCP server connected' : null}
      />

      <ConnectionHealthNotices model={model} />
      <NeedsAttentionSection
        sources={groups.attentionSources}
        rows={attentionRows}
        members={model.connectedMembers}
      />
      {groups.connectedProviders.length > 0 ? (
        <SourceGroup title="Connected sources" sources={groups.connectedProviders} />
      ) : null}
      <SourceGroup
        title="Add a connection"
        sources={groups.addable}
        empty="All available providers are connected."
      />
      <SourceGroup
        title="Capture from email and chat"
        sources={groups.captureSources}
        description="Forwarding and chat bindings attribute captured work to the person or conversation that sent it."
      />

      <IntegrationWorkflow
        sourceRows={model.teamSourceRows}
        activeShareIds={model.activeShareIds}
        isAdmin={isAdmin}
        connectedRows={model.connectedRows}
        connectedMembers={model.connectedMembers}
        hideAttention
      />

      <AdvancedToolsSection sources={groups.advancedSources} isAdmin={isAdmin} />
      <AdvancedIntegrationSection
        isAdmin={isAdmin}
        webhooks={model.ingestWebhookList}
        mcpServerRows={model.mcpServerRows}
        mcpCatalog={model.mcpCatalogAvailable}
      />
    </div>
  );
}

function SourceGroup({
  title,
  sources,
  description,
  empty,
}: {
  title: string;
  sources: SourceEntry[];
  description?: string;
  empty?: string;
}) {
  return (
    <section className="space-y-2">
      {description ? <p className="max-w-3xl px-1 text-sm text-fg-muted">{description}</p> : null}
      {sources.length > 0 ? (
        <CollectionGroup count={sources.length} title={title}>
          {sources.map((source) => (
            <SourceRow key={source.rowId ?? source.label} source={source} />
          ))}
        </CollectionGroup>
      ) : empty ? (
        <EmptyState
          icon={Plug}
          size="inset"
          title={empty.replace(/\.$/, '')}
          body="New providers will appear here once they are configured for this workspace."
        />
      ) : null}
    </section>
  );
}

function SourceRow({ source }: { source: SourceEntry }) {
  const tone =
    source.status === 'attention'
      ? 'danger'
      : source.status === 'connected'
        ? 'success'
        : 'neutral';
  const row = (
    <CollectionRow>
      <CollectionRow.Leading>
        {source.logoSrc ? (
          <ProviderLogo src={source.logoSrc} />
        ) : source.icon ? (
          <source.icon className="size-4 text-fg-dim" aria-hidden="true" />
        ) : null}
      </CollectionRow.Leading>
      <CollectionRow.Title>{source.label}</CollectionRow.Title>
      <CollectionRow.Context>{source.description}</CollectionRow.Context>
      <CollectionRow.Metadata>
        <>
          <CollectionStatus value={source.status} label={source.statusLabel} tone={tone} />
          {source.copyValue ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <code className="max-w-[12rem] truncate font-mono text-[11px] text-fg-dim">
                {source.detail}
              </code>
              <CopyButton value={source.copyValue} label="Copy address" />
            </span>
          ) : (
            <span className="text-[11px] text-fg-dim">{source.detail}</span>
          )}
          {source.note ? <span className="text-[11px] text-fg-dim">{source.note}</span> : null}
        </>
      </CollectionRow.Metadata>
      <CollectionRow.Actions>
        <ItemActionGroup label={`Actions for ${source.label}`}>
          {source.secondaryActionHref ? (
            <Link
              href={source.secondaryActionHref}
              aria-label={`${source.secondaryActionLabel}: ${source.label}`}
              className="inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {source.secondaryActionLabel}
            </Link>
          ) : null}
          {source.connectProviderId ? (
            <NativeProviderConnectButton
              providerId={source.connectProviderId}
              label={source.connectLabel ?? 'Connect'}
              disabled={source.connectDisabled}
            />
          ) : source.actionHref ? (
            <Link
              href={source.actionHref}
              aria-label={`${source.actionLabel}: ${source.label}`}
              className="inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {source.actionLabel}
            </Link>
          ) : null}
        </ItemActionGroup>
      </CollectionRow.Actions>
    </CollectionRow>
  );
  if (!source.rowId) return row;
  return (
    <div id={source.rowId} className="scroll-mt-24">
      {row}
    </div>
  );
}
