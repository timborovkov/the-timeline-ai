'use client';

import Link from 'next/link';

import { ErrorState } from '@/components/error-state';

export default function EntityDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <header className="mb-10 flex flex-col gap-3">
        <Link
          href="/app/entities"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← All entities
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Entity</h1>
      </header>
      <ErrorState
        title="Couldn't load this entity"
        description="The entity profile failed to load."
        error={error}
        reset={reset}
      />
    </div>
  );
}
