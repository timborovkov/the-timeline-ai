'use client';

import { ErrorState } from '@/components/error-state';

export default function HelpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-3">
        <p className="text-xs font-medium text-fg-muted">Help center</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Help</h1>
        <p className="text-lg text-fg-muted">Guides for using Timeline and getting support.</p>
      </header>
      <ErrorState
        title="Unable to load help"
        description="The guide and support links are unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
