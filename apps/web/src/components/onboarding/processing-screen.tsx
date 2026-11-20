'use client';

import type {
  NamedProcessingStep,
  OnboardingSourceIntent,
} from '@timeline/shared/onboarding/first-run';
import Link from 'next/link';

import { CopyableTextField } from '@/components/copyable-text-field';
import { GenerateGroupTokenForm } from '@/components/telegram-forms';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function stepMark(status: NamedProcessingStep['status']): string {
  if (status === 'done') return '✓';
  if (status === 'active' || status === 'failed') return '●';
  return '○';
}

export function ProcessingScreen({
  title,
  description,
  steps,
  inboundEmail,
  emailWaiting,
  connectorWaiting = null,
  telegramBotUsername = null,
  onSwitch,
  onHome,
}: {
  title: string;
  description: string;
  steps: NamedProcessingStep[];
  inboundEmail: string | null;
  emailWaiting: boolean;
  connectorWaiting?: OnboardingSourceIntent | null;
  telegramBotUsername?: string | null;
  onSwitch: () => void;
  onHome: () => void;
}) {
  if (emailWaiting) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for your email</h1>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Send one real thread to your team address. This screen opens the record as soon as it
          arrives.
        </p>
        <div className="mt-4">
          <CopyableTextField
            id="onboarding-waiting-email"
            label="Team email address"
            value={inboundEmail}
            emptyLabel="Team email isn’t configured yet"
            copyLabel="Copy team email"
          />
        </div>
        <div className="mt-4 rounded-md border border-border bg-surface p-4">
          {[
            ['Forward', 'Forward a thread you’re in the middle of.'],
            ['CC or BCC', 'Add the address to a reply you’re about to send.'],
            [
              'Auto-forward',
              'Set a rule in Gmail or Outlook later, on the Go live step. This is not a Gmail connection.',
            ],
          ].map(([label, detail]) => (
            <div key={label} className="flex flex-col gap-1 py-1.5 sm:flex-row sm:gap-2">
              <span className="w-[7.5rem] text-sm font-medium">{label}</span>
              <span className="min-w-0 flex-1 text-sm text-fg-muted">{detail}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="size-2 rounded-full bg-review" />
          <span className="text-sm text-fg-muted">Nothing has arrived yet.</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onHome}>
            Go to Home and wait there
          </Button>
          <Button type="button" variant="outline" onClick={onSwitch}>
            Choose another way
          </Button>
        </div>
      </div>
    );
  }

  if (connectorWaiting === 'slack') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for Slack</h1>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Install Timeline, bind one channel, then send a message there. This screen opens the first
          cited record as soon as that evidence lands.
        </p>
        <div className="mt-4 rounded-md border border-border bg-surface p-4">
          {[
            ['Install', 'Add Timeline to your Slack workspace.'],
            ['Bind', 'Pick one channel on the Slack settings page.'],
            ['Message', 'Post something real in that channel.'],
          ].map(([label, detail]) => (
            <div key={label} className="flex flex-col gap-1 py-1.5 sm:flex-row sm:gap-2">
              <span className="w-[7.5rem] text-sm font-medium">{label}</span>
              <span className="min-w-0 flex-1 text-sm text-fg-muted">{detail}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/api/slack/install/start">Install Slack</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/team/slack">Bind a channel</Link>
          </Button>
          <Button type="button" variant="outline" onClick={onHome}>
            Go to Home and wait there
          </Button>
          <Button type="button" variant="ghost" onClick={onSwitch}>
            Choose another way
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="size-2 rounded-full bg-review" />
          <span className="text-sm text-fg-muted">Nothing has arrived yet.</span>
        </div>
      </div>
    );
  }

  if (connectorWaiting === 'telegram') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for Telegram</h1>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Link one group with the bot, then send a message. This screen opens the first cited record
          as soon as that evidence lands.
        </p>
        <div className="mt-4 space-y-4 rounded-md border border-border bg-surface p-4">
          <GenerateGroupTokenForm botUsername={telegramBotUsername} />
          <div className="space-y-2 text-sm text-fg-muted">
            <p>1. Generate a group link and open it in Telegram.</p>
            <p>2. Send a real message in that group.</p>
            <p>3. Stay here — we open the record when it lands.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onHome}>
            Go to Home and wait there
          </Button>
          <Button type="button" variant="ghost" onClick={onSwitch}>
            Choose another way
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="size-2 rounded-full bg-review" />
          <span className="text-sm text-fg-muted">Nothing has arrived yet.</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{description}</p>
      <ol className="mt-5 border-t border-border">
        {steps.map((step) => (
          <li key={step.id} className="flex gap-3 border-b border-border py-2.5">
            <span
              className={cn(
                'w-4 text-center text-sm',
                step.status === 'done'
                  ? 'text-success'
                  : step.status === 'active'
                    ? 'text-review'
                    : step.status === 'failed'
                      ? 'text-danger'
                      : 'text-fg-dim',
              )}
            >
              {stepMark(step.status)}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-sm',
                  step.status === 'waiting' ? 'text-fg-dim' : 'text-fg',
                  step.status === 'active' && 'font-medium',
                )}
              >
                {step.label}
              </div>
              {step.detail ? <div className="mt-0.5 text-xs text-fg-dim">{step.detail}</div> : null}
            </div>
            <span className="text-xs text-fg-dim">
              {step.status === 'done'
                ? 'Done'
                : step.status === 'active'
                  ? 'In progress'
                  : step.status === 'failed'
                    ? 'Failed'
                    : 'Waiting'}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onHome}>
          Go to Home and wait there
        </Button>
        <Button type="button" variant="ghost" onClick={onSwitch}>
          Choose another way
        </Button>
      </div>
    </div>
  );
}
