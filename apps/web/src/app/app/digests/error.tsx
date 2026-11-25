'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function DigestsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        variant="collection"
        title="Update history"
        subtitle="Open an update to see what it covered."
      />
      <ErrorState
        title="Unable to load update history"
        description="Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
