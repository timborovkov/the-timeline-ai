'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function SourcesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Connections" subtitle="Provider accounts and team sync." />
      <ErrorState
        title="Unable to load connections"
        description="Your connection settings and captured data have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
