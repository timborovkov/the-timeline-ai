import { withTeam } from '@timeline/shared/team-scope';
import {
  Bot,
  ChevronDown,
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

import { CopyButton } from '@/components/copy-button';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
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
        <SectionHeading>Advanced tools</SectionHeading>
        <details className="group rounded-md border border-border bg-surface p-4">
          <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-sm text-sm font-medium text-fg outline-none transition-colors hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            <span>MCP, webhooks, and audit tools</span>
            <ChevronDown
              aria-hidden="true"
              data-disclosure-indicator
              className="size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none group-open:rotate-180"
            />
          </summary>
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {advancedSources.map((source) => (
              <SourceRow key={source.label} source={source} />
            ))}
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                href="/app/team/integrations"
                className="rounded-sm border border-border px-3 py-2 hover:bg-surface-2"
              >
                Provider resources and webhooks
              </Link>
              {isAdmin ? (
                <>
                  <Link
                    href="/app/team/mcp-share"
                    className="rounded-sm border border-border px-3 py-2 hover:bg-surface-2"
                  >
                    Outbound MCP sharing
                  </Link>
                  <Link
                    href="/app/team/integrations/audit"
                    className="rounded-sm border border-border px-3 py-2 hover:bg-surface-2"
                  >
                    Integration audit
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </details>
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
    <section className="space-y-3">
      <SectionHeading>{title}</SectionHeading>
      {description ? <p className="max-w-3xl text-sm text-fg-muted">{description}</p> : null}
      {sources.length > 0 ? (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow key={source.label} source={source} />
          ))}
        </div>
      ) : empty ? (
        <p className="text-sm text-fg-muted">{empty}</p>
      ) : null}
    </section>
  );
}

function SourceRow({ source }: { source: SourceEntry }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <source.icon className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">{source.label}</span>
            <span
              className={
                source.status === 'attention'
                  ? 'text-xs font-medium text-danger'
                  : source.status === 'connected'
                    ? 'text-xs font-medium text-signal'
                    : 'text-xs text-fg-muted'
              }
            >
              {source.statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-fg-muted">{source.description}</p>
          {source.copyValue ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              <code className="min-w-0 break-all font-mono text-xs text-fg-dim">
                {source.detail}
              </code>
              <CopyButton value={source.copyValue} label="Copy address" />
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-fg-dim">{source.detail}</p>
          )}
          {source.note ? <p className="mt-1 text-xs text-fg-muted">{source.note}</p> : null}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
        {source.secondaryActionHref ? (
          <Link
            href={source.secondaryActionHref}
            aria-label={`${source.secondaryActionLabel}: ${source.label}`}
            className="inline-flex min-h-9 items-center rounded-sm px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {source.secondaryActionLabel}
          </Link>
        ) : null}
        <Link
          href={source.actionHref}
          aria-label={`${source.actionLabel}: ${source.label}`}
          className="inline-flex min-h-9 items-center rounded-sm border border-border px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {source.actionLabel}
        </Link>
      </div>
    </div>
  );
}
