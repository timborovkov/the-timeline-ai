'use client';

import { WORK_STYLE_OPTIONS, type TeamWorkStyle } from '@timeline/shared/onboarding/first-run';
import { useState, useTransition } from 'react';

import { updateWorkStylePreferenceAction } from '@/app/actions/first-run';
import { cn } from '@/lib/utils';

export function WorkStylePreference({
  initialWorkStyle,
}: {
  initialWorkStyle: TeamWorkStyle | null;
}) {
  const [workStyle, setWorkStyle] = useState<TeamWorkStyle | null>(initialWorkStyle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: TeamWorkStyle | null) {
    setWorkStyle(next);
    setError(null);
    startTransition(() => {
      void updateWorkStylePreferenceAction({ workStyle: next }).then((result) => {
        if (!result.ok) setError(result.error ?? 'Could not save work style.');
      });
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        How your team mostly works. This only reorders suggestions and the recommended go-live
        channel. It is not about team size.
      </p>
      <div className="flex flex-wrap gap-2">
        {WORK_STYLE_OPTIONS.map((option) => {
          const selected = workStyle === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={pending}
              onClick={() => {
                save(selected ? null : option.id);
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
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
