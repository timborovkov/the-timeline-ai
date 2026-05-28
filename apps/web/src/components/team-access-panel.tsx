import { composePostmarkHashAddress } from '@timeline/shared/slug';
import { Cable, Mail, MessageSquare, Send } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode } from 'react';

import { CopyButton } from '@/components/copy-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TeamAccessPanelProps {
  team: {
    slug: string;
    inboundEmail: string | null;
  } | null;
  telegramConnectionCount?: number;
  slackConnectionCount?: number;
  integrationConnectionCount?: number;
}

export function TeamAccessPanel({
  team,
  telegramConnectionCount,
  slackConnectionCount,
  integrationConnectionCount,
}: TeamAccessPanelProps) {
  const ingestEmail = getDisplayIngestEmail(team);

  return (
    <Card id="email-ingest">
      <CardHeader className="space-y-1 pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Ingest access</CardTitle>
          <Mail className="size-4 text-fg-dim" aria-hidden="true" />
        </div>
        <p className="text-sm text-fg-muted">
          Forward, CC, or BCC email here to add it to the timeline.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {ingestEmail ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 select-all break-all rounded-sm border border-border bg-surface-2 px-2 py-2 font-mono text-xs text-fg">
              {ingestEmail}
            </code>
            <CopyButton value={ingestEmail} />
          </div>
        ) : (
          <p className="rounded-sm border border-border bg-surface-2 px-2 py-2 text-sm text-fg-muted">
            Email ingest is not configured for this team yet.
          </p>
        )}

        <p className="text-xs text-fg-muted">
          Senders must match a team member&apos;s email to be attributed; unknown senders still land
          but are tagged unverified.
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <AccessLink
            href="/app/team/telegram"
            icon={<Send className="size-3.5" aria-hidden="true" />}
            label="Telegram"
            meta={formatCount(telegramConnectionCount, 'linked')}
          />
          <AccessLink
            href="/app/team/slack"
            icon={<MessageSquare className="size-3.5" aria-hidden="true" />}
            label="Slack"
            meta={formatCount(slackConnectionCount, 'linked')}
          />
          <AccessLink
            href="/app/team/integrations"
            icon={<Cable className="size-3.5" aria-hidden="true" />}
            label="Integrations"
            meta={formatCount(integrationConnectionCount, 'connected')}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function getDisplayIngestEmail(team: TeamAccessPanelProps['team']): string | null {
  if (!team) return null;
  const productionAddr =
    team.inboundEmail && !team.inboundEmail.endsWith('@inbound.invalid') ? team.inboundEmail : null;
  return (
    productionAddr ?? composePostmarkHashAddress(team.slug, process.env.POSTMARK_INBOUND_ADDRESS)
  );
}

function formatCount(count: number | undefined, label: string): string | undefined {
  return typeof count === 'number' ? `${String(count)} ${label}` : undefined;
}

function AccessLink({
  href,
  icon,
  label,
  meta,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg"
    >
      {icon}
      <span>{label}</span>
      {meta ? <span className="text-fg-dim">· {meta}</span> : null}
    </Link>
  );
}
