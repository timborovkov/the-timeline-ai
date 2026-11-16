'use client';

import { ErrorState } from '@/components/error-state';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Workspace</h1>
      <ErrorState
        title="Unable to load this page"
        description="This workspace page could not be loaded. Your captured history and saved work are unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
