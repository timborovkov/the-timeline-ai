'use client';

import { ErrorState } from '@/components/error-state';

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Chat</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ask the timeline</h1>
      </header>
      <ErrorState
        title="Couldn't open chat"
        description="The chat surface failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}
