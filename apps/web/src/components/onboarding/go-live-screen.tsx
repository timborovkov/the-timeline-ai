'use client';

import {
  recommendedGoLiveChannel,
  type GoLiveChannel,
  type TeamWorkStyle,
} from '@timeline/shared/onboarding/first-run';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  completeFirstRunAction,
  goToOnboardingHomeAction,
  recordAgentDeployedAction,
} from '@/app/actions/first-run';
import { updateDigestPreferenceAction } from '@/app/actions/teams';
import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CHANNELS: {
  id: Exclude<GoLiveChannel, 'digest'>;
  title: string;
  body: (inboundEmail: string | null) => string;
  action: string;
  href?: string;
}[] = [
  {
    id: 'slack',
    title: 'Install or link Slack',
    body: () => 'Bind Slack conversations and user identity.',
    action: 'Install Slack',
    href: '/api/slack/install/start',
  },
  {
    id: 'telegram',
    title: 'Link Telegram',
    body: () => 'Let chats and voice notes flow into the timeline.',
    action: 'Link Telegram',
    href: '/app/connections/sources#telegram',
  },
  {
    id: 'email',
    title: 'Forward email into the timeline',
    body: (inboundEmail) =>
      inboundEmail
        ? `Add an auto-forward or BCC rule in Gmail or Outlook to ${inboundEmail}. This is not a Gmail connection.`
        : 'Add an auto-forward or BCC rule in Gmail or Outlook to your team address. This is not a Gmail connection.',
    action: 'Show me how',
  },
  {
    id: 'meeting',
    title: 'Invite the agent to a call',
    body: () => 'Send the silent bot to a call so the transcript lands in the timeline.',
    action: 'Invite to a call',
    href: '/app/meetings',
  },
];

export function GoLiveScreen({
  workStyle,
  inboundEmail,
  digestEnabled,
}: {
  workStyle: TeamWorkStyle | null;
  inboundEmail: string | null;
  digestEnabled: boolean;
}) {
  const router = useRouter();
  const recommended = recommendedGoLiveChannel(workStyle);
  const [digest, setDigest] = useState(digestEnabled);
  const [showEmailHow, setShowEmailHow] = useState(false);
  const [pending, startTransition] = useTransition();
  const ordered = recommended
    ? [
        ...CHANNELS.filter((row) => row.id === recommended),
        ...CHANNELS.filter((row) => row.id !== recommended),
      ]
    : CHANNELS;

  function openChannel(channel: GoLiveChannel, href?: string) {
    if (channel === 'email') {
      setShowEmailHow(true);
      startTransition(() => {
        void recordAgentDeployedAction('email');
      });
      return;
    }
    if (href) router.push(href);
  }

  return (
    <div className="max-w-3xl">
      <p className="text-xs text-fg-dim">Go live</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Keep it updating itself</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        So far this is one snapshot. Connect where your team already talks and the record keeps
        itself current. One is enough to start.
      </p>
      <div className="mt-4 border-t border-border">
        {ordered.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center gap-3 border-b border-border py-3"
          >
            <div className="min-w-0 flex-1 basis-[14rem]">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{row.title}</span>
                {row.id === recommended ? (
                  <span className="text-xs text-signal">Recommended for how you work</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs leading-5 text-fg-muted">{row.body(inboundEmail)}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                openChannel(row.id, row.href);
              }}
            >
              {row.action}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 border-b border-border py-3">
          <div className="min-w-0 flex-1 basis-[14rem]">
            <div className="text-sm font-medium">Set up daily digests</div>
            <p className="mt-0.5 text-xs text-fg-muted">
              A morning summary of what changed and what needs attention.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={digest}
            aria-label="Daily digest"
            disabled={pending}
            onClick={() => {
              const next = !digest;
              setDigest(next);
              startTransition(() => {
                const form = new FormData();
                if (next) form.set('dailyDigestEnabled', 'on');
                void updateDigestPreferenceAction({}, form);
                if (next) void recordAgentDeployedAction('digest');
              });
            }}
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              digest ? 'bg-signal' : 'bg-surface-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-4 rounded-full transition-[left] ',
                digest ? 'left-[18px] bg-signal-fg' : 'left-0.5 bg-fg-dim',
              )}
            />
          </button>
        </div>
      </div>
      {showEmailHow ? (
        <div className="mt-4 rounded-md border border-border bg-surface p-4">
          <p className="text-sm font-medium">Auto-forward or BCC</p>
          <p className="mt-1 text-sm leading-6 text-fg-muted">
            In Gmail or Outlook, add a rule that forwards or BCCs mail to this team address. There
            is no native Gmail connection.
          </p>
          <div className="mt-3">
            <CopyableTextField
              id="go-live-email"
              label="Team email address"
              value={inboundEmail}
              emptyLabel="Team email isn’t configured yet"
              copyLabel="Copy team email"
            />
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-fg-muted">
        Invite teammates once there&apos;s something worth sharing. It stays on your checklist.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button type="button" disabled={pending} onClick={() => void goToOnboardingHomeAction()}>
          Go to Home
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            startTransition(() => {
              void completeFirstRunAction().then(() => {
                router.push('/app');
              });
            });
          }}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}
