'use client';

import { ErrorState } from '@/components/error-state';

export default function TimelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Timeline</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Timeline</h1>
      </header>
      <ErrorState
        title="Couldn't load the timeline"
        description="The feed failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}
