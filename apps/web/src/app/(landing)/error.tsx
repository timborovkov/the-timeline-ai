'use client';

import { LandingRecoveryShell } from '@/app/(landing)/_landing-recovery-shell';
import { ErrorState } from '@/components/error-state';

export default function LandingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LandingRecoveryShell>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <header className="border-l-2 border-signal pl-5 sm:pl-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
            The Timeline
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
            Ask what changed.
          </h1>
          <p className="mt-5 max-w-prose text-base leading-[1.65] text-fg-muted">
            Cited updates, handoffs, digests, and answers from the work already happening.
          </p>
        </header>
        <div className="mt-10">
          <ErrorState
            title="Unable to load The Timeline"
            description="This failed load did not change any account or workspace data. Check your connection, then try again."
            error={error}
            reset={reset}
          />
        </div>
      </div>
    </LandingRecoveryShell>
  );
}
