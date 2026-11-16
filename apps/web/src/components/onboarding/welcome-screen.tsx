'use client';

import { WORK_STYLE_OPTIONS, type TeamWorkStyle } from '@timeline/shared/onboarding/first-run';
import { useState, useTransition } from 'react';

import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function WelcomeScreen({
  teamName,
  inboundEmail,
  initialWorkStyle,
  onContinue,
}: {
  teamName: string;
  inboundEmail: string | null;
  initialWorkStyle: TeamWorkStyle | null;
  onContinue: (workStyle: TeamWorkStyle | null) => Promise<void>;
}) {
  const [workStyle, setWorkStyle] = useState<TeamWorkStyle | null>(initialWorkStyle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(next: TeamWorkStyle | null) {
    setError(null);
    startTransition(async () => {
      try {
        await onContinue(next);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not continue.');
      }
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight md:text-[24px]">Your team is ready</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        We created {teamName} and its team email address. Anything you forward there lands on your
        timeline.
      </p>
      <div className="mt-4">
        <CopyableTextField
          id="onboarding-team-email"
          label="Team email address"
          value={inboundEmail}
          emptyLabel="Team email isn’t configured yet"
          copyLabel="Copy team email"
        />
      </div>
      <div className="my-6 h-px bg-border" />
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">How does your team mostly work?</h2>
        <span className="text-xs text-fg-dim">Optional</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {WORK_STYLE_OPTIONS.map((option) => {
          const selected = workStyle === option.id;
          return (
            <button
              key={option.id}
              aria-pressed={selected}
              disabled={pending}
              type="button"
              onClick={() => {
                setWorkStyle(selected ? null : option.id);
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-left text-sm transition-colors',
                selected
                  ? 'border-signal bg-signal-soft text-fg'
                  : 'border-border bg-transparent text-fg hover:border-border-strong',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-5 text-fg-muted">
        We use this to order your suggestions and what to connect first. Change it any time in Team
        → Preferences.
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            submit(workStyle);
          }}
        >
          Continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            submit(null);
          }}
        >
          Skip question
        </Button>
      </div>
    </div>
  );
}
