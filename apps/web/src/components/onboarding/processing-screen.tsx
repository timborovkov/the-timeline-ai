'use client';

import type { NamedProcessingStep } from '@timeline/shared/onboarding/first-run';

import { CopyableTextField } from '@/components/copyable-text-field';
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
  onSwitch,
  onHome,
}: {
  title: string;
  description: string;
  steps: NamedProcessingStep[];
  inboundEmail: string | null;
  emailWaiting: boolean;
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
            <div key={label} className="flex flex-wrap gap-2 py-1.5">
              <span className="w-[7.5rem] text-sm font-medium">{label}</span>
              <span className="min-w-0 flex-1 text-sm text-fg-muted">{detail}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="size-2 rounded-full bg-review" />
          <span className="text-sm text-fg-muted">Nothing has arrived yet.</span>
        </div>
        <div className="mt-5">
          <Button type="button" variant="outline" onClick={onSwitch}>
            Choose another way
          </Button>
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
      <div className="mt-5">
        <Button type="button" variant="outline" onClick={onHome}>
          Go to Home and wait there
        </Button>
      </div>
    </div>
  );
}
