'use client';

import type {
  NamedProcessingStep,
  OnboardingSourceIntent,
} from '@timeline/shared/onboarding/first-run';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/copy-button';
import { CopyableTextField } from '@/components/copyable-text-field';
import { GenerateGroupTokenForm } from '@/components/telegram-forms';
import { Button } from '@/components/ui/button';
import { useRegionalFormat } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime } from '@/lib/display-dates';
import { isoTimestamp, toDateOrNull } from '@/lib/iso-timestamp';
import { cn } from '@/lib/utils';

function stepMark(status: NamedProcessingStep['status']): string {
  if (status === 'done') return '✓';
  if (status === 'active' || status === 'failed') return '●';
  return '○';
}

export function ProcessingScreen({
  title,
  description,
  startedAt,
  captureUrl,
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
  startedAt?: Date | string | null;
  captureUrl?: string | null;
  steps: NamedProcessingStep[];
  inboundEmail: string | null;
  emailWaiting: boolean;
  connectorWaiting?: OnboardingSourceIntent | null;
  telegramBotUsername?: string | null;
  onSwitch: () => void;
  onHome?: () => void;
}) {
  const actions = (
    <div className="mt-5 flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href="/app" onNavigate={onHome}>
          Go to Home
        </Link>
      </Button>
      <Button type="button" variant="ghost" onClick={onSwitch}>
        Choose another way
      </Button>
      {captureUrl ? <CopyButton value={captureUrl} label="Copy capture link" /> : null}
    </div>
  );

  if (connectorWaiting) {
    return (
      <ConnectorCaptureWaiting
        connector={connectorWaiting}
        startedAt={startedAt}
        telegramBotUsername={telegramBotUsername}
      >
        {actions}
      </ConnectorCaptureWaiting>
    );
  }

  if (emailWaiting) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for your email</h1>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Send one real thread to your team address. You can keep working and check Home for
          updates.
        </p>
        {startedAt ? <CaptureStartedTime value={startedAt} waiting /> : null}
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
        {actions}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{description}</p>
      {startedAt ? <CaptureStartedTime value={startedAt} /> : null}
      <CaptureProcessingSteps steps={steps} />
      {actions}
    </div>
  );
}

function ConnectorCaptureWaiting({
  connector,
  startedAt,
  telegramBotUsername,
  children,
}: {
  connector: OnboardingSourceIntent;
  startedAt?: Date | string | null;
  telegramBotUsername: string | null;
  children: ReactNode;
}) {
  const slack = connector === 'slack';
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {slack ? 'Waiting for Slack' : 'Waiting for Telegram'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        {slack
          ? 'Install Timeline, bind one channel, then send a message there.'
          : 'Link one group with the bot, then send a message.'}{' '}
        You can keep working and check Home for updates.
      </p>
      {startedAt ? <CaptureStartedTime value={startedAt} waiting /> : null}
      {slack ? (
        <div className="mt-4 flex flex-wrap gap-2 rounded-md border border-border bg-surface p-4">
          <Button asChild>
            <Link href="/api/slack/install/start">Install Slack</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/app/team/slack">Bind a channel</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4 rounded-md border border-border bg-surface p-4">
          <GenerateGroupTokenForm botUsername={telegramBotUsername} />
          <p className="text-sm text-fg-muted">
            Open the group link in Telegram, then send a message in that group.
          </p>
        </div>
      )}
      <p className="mt-4 text-sm text-fg-muted">Nothing has arrived yet.</p>
      {children}
    </div>
  );
}

export function CaptureStartedTime({
  value,
  waiting,
}: {
  value: Date | string;
  waiting?: boolean;
}) {
  const region = useRegionalFormat();
  const date = toDateOrNull(value);
  const iso = isoTimestamp(value);
  if (!date || !iso) return null;
  return (
    <p className="mt-2 text-xs text-fg-dim">
      {waiting ? 'Waiting since' : 'Started'}{' '}
      <time dateTime={iso}>{formatDisplayDateTime(date, region)}</time>
    </p>
  );
}

export function CaptureProcessingSteps({ steps }: { steps: NamedProcessingStep[] }) {
  if (!steps.length) return null;
  return (
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
  );
}
