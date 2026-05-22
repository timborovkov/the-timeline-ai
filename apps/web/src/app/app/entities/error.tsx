'use client';

import { ErrorState } from '@/components/error-state';

export default function EntitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entities</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Entities</h1>
      </header>
      <ErrorState
        title="Couldn't load entities"
        description="The extracted entities failed to load. This is usually transient."
        error={error}
        reset={reset}
      />
    </div>
  );
}
