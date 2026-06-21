import { withTeam } from '@timeline/shared/team-scope';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Circle,
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

import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSourcesStatusSummary, type SourcesStatusSummary } from '@/lib/hub-status';

export const metadata: Metadata = {
  title: 'Connections',
  description: 'Capture and integration surfaces that feed the timeline.',
};

type SourceStatus = 'connected' | 'attention' | 'not-setup';

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
}

function buildSources(summary: SourcesStatusSummary): SourceEntry[] {
  const emailConnected = Boolean(summary.inboundEmail);
  const emailForwarded = summary.emailForwarded;
  const email: SourceEntry = {
    href: '/app#email-ingest',
    label: 'Email',
    description: 'Forward, CC, or BCC team mail into the archive.',
    icon: Mail,
    status: emailForwarded ? 'connected' : emailConnected ? 'attention' : 'not-setup',
    statusLabel: emailForwarded
      ? 'Connected'
      : emailConnected
        ? 'Ready, no mail yet'
        : 'Not set up',
    actionHref: emailConnected ? '/app#email-ingest' : '/app/team',
    actionLabel: emailConnected ? 'Manage' : 'Set up email',
    detail: emailConnected ? `Inbound: ${summary.inboundEmail}` : 'No inbound address configured',
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
    description: 'Connect Google Drive, Linear, and GitHub.',
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

function StatusIcon({ status }: { status: SourceStatus }) {
  if (status === 'attention')
    return <AlertTriangle className="size-4 text-danger" aria-hidden="true" />;
  if (status === 'connected')
    return <CheckCircle2 className="size-4 text-signal" aria-hidden="true" />;
  return <Circle className="size-4 text-fg-dim" aria-hidden="true" />;
}

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const summary = await getSourcesStatusSummary(scope);
  const sources = buildSources(summary);
  const attentionSources = sources.filter((s) => s.status === 'attention');
  const notSetupSources = sources.filter((s) => s.status === 'not-setup');
  const connectedSources = sources.filter((s) => s.status === 'connected');
  const attentionCount = summary.attention;
  const connectedCount = connectedSources.length;
  const notSetupCount = notSetupSources.length;
  const sorted = [...attentionSources, ...notSetupSources, ...connectedSources];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Connections"
        subtitle="Capture surfaces, native sync, and live external tools."
        srLabel={`Connections · ${active.teamName} · ${connectedCount} connected · ${attentionCount} need attention · ${notSetupCount} not set up`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          { label: 'connected', value: connectedCount },
          ...(attentionCount > 0
            ? ([{ label: 'attention', value: attentionCount, danger: true }] as const)
            : ([] as const)),
          ...(notSetupCount > 0
            ? ([{ label: 'not set up', value: notSetupCount }] as const)
            : ([] as const)),
        ]}
      />

      <div className="space-y-3">
        {sorted.map((source) => (
          <div
            key={source.label}
            className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-surface p-4"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <source.icon className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
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
                <p className="mt-0.5 text-xs text-fg-dim">{source.detail}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon status={source.status} />
              {source.secondaryActionHref ? (
                <Link
                  href={source.secondaryActionHref}
                  className="inline-flex min-h-8 items-center rounded-sm border border-transparent px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {source.secondaryActionLabel}
                </Link>
              ) : null}
              <Link
                href={source.actionHref}
                className="inline-flex min-h-8 items-center rounded-sm border border-border px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {source.actionLabel}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
