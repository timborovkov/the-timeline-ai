import { withTeam } from '@timeline/shared';
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
import { redirect } from 'next/navigation';

import type { HubMetric } from '@/components/hub-status-card';
import type { Metadata } from 'next';

import { HubStatusCard } from '@/components/hub-status-card';
import { IndexStrip } from '@/components/index-strip';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getSourcesStatusSummary, type SourcesStatusSummary } from '@/lib/hub-status';

export const metadata: Metadata = {
  title: 'Sources',
  description: 'Capture and integration surfaces that feed the timeline.',
};

const SOURCE_LINKS: readonly {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  metrics: (summary: SourcesStatusSummary) => readonly HubMetric[];
}[] = [
  {
    href: '/app#email-ingest',
    label: 'Email',
    description: 'Forward, CC, or BCC team mail into the archive.',
    icon: Mail,
    metrics: (summary) => [
      {
        label: 'address',
        value: summary.inboundEmail ? 'ready' : 'missing',
        tone: summary.inboundEmail ? 'signal' : 'danger',
      },
      {
        label: 'forwarded',
        value: summary.emailForwarded ? 'yes' : 'not yet',
        tone: summary.emailForwarded ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/team/slack',
    label: 'Slack',
    description: 'Capture DMs, channel messages, slash-command answers, and linked sender context.',
    icon: MessageSquare,
    metrics: (summary) => [
      {
        label: 'linked',
        value: summary.slackConnections,
        tone: summary.slackConnections ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/team/telegram',
    label: 'Telegram',
    description: 'Route chat and voice notes into the same capture pipeline.',
    icon: Send,
    metrics: (summary) => [
      {
        label: 'linked',
        value: summary.telegramConnections,
        tone: summary.telegramConnections ? 'signal' : 'neutral',
      },
    ],
  },
  {
    href: '/app/documents',
    label: 'Documents',
    description: 'Upload source material the agent can search, cite, and version.',
    icon: FileText,
    metrics: (summary) => [
      {
        label: 'files',
        value: summary.documentsTotal,
        tone: summary.documentsTotal ? 'signal' : 'neutral',
      },
      {
        label: 'attention',
        value: summary.documentAttention,
        tone: summary.documentAttention ? 'danger' : 'neutral',
      },
    ],
  },
  {
    href: '/app/meetings',
    label: 'Meetings',
    description: 'Invite silent notetakers for transcript capture from live calls.',
    icon: Video,
    metrics: (summary) => [
      {
        label: 'recent',
        value: summary.meetingsRecent,
        tone: summary.meetingsRecent ? 'signal' : 'neutral',
      },
      {
        label: 'active',
        value: summary.meetingsActive,
        tone: summary.meetingsActive ? 'signal' : 'neutral',
      },
      {
        label: 'failed',
        value: summary.meetingsFailed,
        tone: summary.meetingsFailed ? 'danger' : 'neutral',
      },
      { label: 'minutes', value: summary.meetingMinutesUsed },
    ],
  },
  {
    href: '/app/team/integrations',
    label: 'Integrations',
    description: 'Connect Google Drive, Linear, GitHub, and native sync providers.',
    icon: Plug,
    metrics: (summary) => [
      {
        label: 'connected',
        value: summary.nativeIntegrations,
        tone: summary.nativeIntegrations ? 'signal' : 'neutral',
      },
      {
        label: 'errors',
        value: summary.integrationErrors,
        tone: summary.integrationErrors ? 'danger' : 'neutral',
      },
    ],
  },
  {
    href: '/app/team/mcp-servers',
    label: 'MCP servers',
    description: 'Attach custom external tools and searchable systems to the team.',
    icon: Bot,
    metrics: (summary) => [
      {
        label: 'servers',
        value: summary.mcpServers,
        tone: summary.mcpServers ? 'signal' : 'neutral',
      },
      {
        label: 'errors',
        value: summary.mcpErrors,
        tone: summary.mcpErrors ? 'danger' : 'neutral',
      },
    ],
  },
] as const;

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const summary = await getSourcesStatusSummary(scope, active.teamId, session.user.id);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <IndexStrip
        srLabel={`Sources · ${active.teamName} · ${SOURCE_LINKS.length} capture surfaces`}
        segments={[
          { value: 'SOURCES' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'surfaces', value: SOURCE_LINKS.length },
          ...(summary.attention > 0
            ? ([{ label: 'attention', value: summary.attention, signal: true }] as const)
            : ([] as const)),
        ]}
      />

      <div className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2">
        {SOURCE_LINKS.map((item) => (
          <HubStatusCard
            key={item.href}
            href={item.href}
            label={item.label}
            description={item.description}
            icon={item.icon}
            metrics={item.metrics(summary)}
          />
        ))}
      </div>
    </div>
  );
}
