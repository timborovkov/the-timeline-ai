import { withTeam } from '@timeline/shared/team-scope';
import {
  Bot,
  FileText,
  Mail,
  MessageSquare,
  Plug,
  Send,
  Video,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSourcesStatusSummary, type SourcesStatusSummary } from '@/lib/hub-status';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Capture and integration surfaces that feed the timeline.',
};

type SourceStatus = 'connected' | 'attention' | 'not-setup';

const CAPTURE_LABELS = new Set(['Email', 'Slack', 'Telegram']);
const ADVANCED_LABELS = new Set(['MCP servers']);

interface SourceEntry {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  status: SourceStatus;
  statusLabel: string;
  actionHref: string;
  actionLabel: string;
  secondaryActionHref?: string;
  secondaryActionLabel?: string;
  detail: string;
  copyValue?: string;
  note?: string;
}

function buildSources(summary: SourcesStatusSummary): SourceEntry[] {
  const emailConnected = Boolean(summary.inboundEmail);
  const emailForwarded = summary.emailForwarded;
  const email: SourceEntry = {
    href: '/app/sources',
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

  const slackConnected = summary.slackConnections > 0;
  const slack: SourceEntry = {
    href: '/app/team/slack',
    label: 'Slack',
    description: 'Capture DMs, channel messages, and linked sender context.',
    icon: MessageSquare,
    status: slackConnected ? 'connected' : 'not-setup',
    statusLabel: slackConnected ? 'Connected' : 'Not set up',
    actionHref: '/app/team/slack',
    actionLabel: slackConnected ? 'Manage' : 'Install Slack',
    detail: slackConnected
      ? `${summary.slackConnections} link${summary.slackConnections === 1 ? '' : 's'}`
      : 'No Slack workspaces linked',
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
      summary.meetingsFailed > 0 ? '/app/team/jobs?kind=meeting_finalization' : '/app/meetings',
    actionLabel:
      summary.meetingsFailed > 0 ? 'Review failures' : meetingsAny ? 'Manage' : 'Invite notetaker',
    secondaryActionHref: summary.meetingsFailed > 0 ? '/app/meetings' : undefined,
    secondaryActionLabel: summary.meetingsFailed > 0 ? 'Open meetings' : undefined,
    detail: meetingsAny ? `${summary.meetingsRecent} recent` : 'No meetings captured yet',
  };

  const integrationsAny = summary.nativeIntegrations > 0;
  const integrations: SourceEntry = {
    href: '/app/team/integrations',
    label: 'Integrations',
    description: 'Connect Google Drive, Linear, GitHub, Monday.com, Slack, and Sentry.',
    icon: Plug,
    status:
      summary.integrationErrors > 0 ? 'attention' : integrationsAny ? 'connected' : 'not-setup',
    statusLabel:
      summary.integrationErrors > 0
        ? `${summary.integrationErrors} need reconnect`
        : integrationsAny
          ? 'Connected'
          : 'Not set up',
    actionHref: '/app/team/integrations',
    actionLabel:
      summary.integrationErrors > 0 ? 'Reconnect' : integrationsAny ? 'Manage' : 'Connect',
    detail: integrationsAny
      ? `${summary.nativeIntegrations} connected`
      : 'No integrations connected',
  };

  const mcpAny = summary.mcpServers > 0;
  const mcp: SourceEntry = {
    href: '/app/team/integrations',
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
    actionHref: '/app/team/integrations',
    actionLabel: summary.mcpErrors > 0 ? 'Review issues' : mcpAny ? 'Manage' : 'Add server',
    detail: mcpAny
      ? `${summary.mcpServers} server${summary.mcpServers === 1 ? '' : 's'}`
      : 'No MCP servers added',
  };

  return [email, slack, telegram, docs, meetings, integrations, mcp];
}

function sourceDoesNotNeedAttention(source: SourceEntry): boolean {
  return source.status !== 'attention';
}

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const [role, summary] = await Promise.all([
    scope.requireMembership(),
    getSourcesStatusSummary(scope),
  ]);
  const isAdmin = role === 'owner' || role === 'admin';
  const sources = buildSources(summary);
  const attentionSources = sources.filter((s) => s.status === 'attention');
  const notSetupSources = sources.filter((s) => s.status === 'not-setup');
  const connectedSources = sources.filter((s) => s.status === 'connected');
  const attentionCount = summary.attention;
  const connectedCount = connectedSources.length;
  const notSetupCount = notSetupSources.length;
  const connectedProviders = connectedSources.filter(
    (source) => !CAPTURE_LABELS.has(source.label) && !ADVANCED_LABELS.has(source.label),
  );
  const addable = notSetupSources.filter(
    (source) => !CAPTURE_LABELS.has(source.label) && !ADVANCED_LABELS.has(source.label),
  );
  const captureSources = sources.filter(
    (source) => CAPTURE_LABELS.has(source.label) && sourceDoesNotNeedAttention(source),
  );
  const advancedSources = sources.filter((source) => ADVANCED_LABELS.has(source.label));

  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Connections"
        subtitle="Capture surfaces, native sync, and live external tools."
        srLabel={`Connections · ${active.teamName} · ${connectedCount} connected · ${attentionCount} need attention · ${notSetupCount} not set up`}
        metadata={[
          { label: 'Team', value: active.teamName },
          { label: 'Connected', value: connectedCount, mono: true },
          ...(attentionCount > 0
            ? ([{ label: 'Attention', value: attentionCount, mono: true, danger: true }] as const)
            : ([] as const)),
          ...(notSetupCount > 0
            ? ([{ label: 'Not set up', value: notSetupCount, mono: true }] as const)
            : ([] as const)),
        ]}
      />

      {attentionSources.length > 0 ? (
        <SourceGroup title="Needs attention" sources={attentionSources} />
      ) : null}
      {connectedProviders.length > 0 ? (
        <SourceGroup title="Connected sources" sources={connectedProviders} />
      ) : null}
      <SourceGroup
        title="Add a connection"
        sources={addable}
        empty="All available providers are connected."
      />
      <SourceGroup
        title="Capture from email and chat"
        sources={captureSources}
        description="Forwarding and chat bindings attribute captured work to the person or conversation that sent it."
      />
      <section className="space-y-3">
        <CollectionGroup count={advancedSources.length} title="Advanced tools">
          {advancedSources.map((source) => (
            <SourceRow key={source.label} source={source} />
          ))}
          <div className="flex flex-wrap gap-2 px-3 py-2 text-sm">
            <Link
              href="/app/team/integrations"
              className="rounded-sm px-2.5 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              Provider resources and webhooks
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
              </>
            ) : null}
          </div>
        </CollectionGroup>
      </section>
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
            <SourceRow key={source.label} source={source} />
          ))}
        </CollectionGroup>
      ) : empty ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : null}
    </section>
  );
}

function SourceRow({ source }: { source: SourceEntry }) {
  const tone =
    source.status === 'attention' ? 'danger' : source.status === 'connected' ? 'success' : 'neutral';
  return (
    <CollectionRow
      leading={<source.icon className="size-4 text-fg-dim" aria-hidden="true" />}
      title={source.label}
      context={source.description}
      metadata={
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
      }
      actions={
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
          <Link
            href={source.actionHref}
            aria-label={`${source.actionLabel}: ${source.label}`}
            className="inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {source.actionLabel}
          </Link>
        </ItemActionGroup>
      }
    />
  );
}
