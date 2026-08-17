'use client';

import { ErrorState } from '@/components/error-state';
import { JobsPageHeader } from '@/components/job-recovery/jobs-page-header';

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <JobsPageHeader />
      <ErrorState
        title="Unable to load background jobs"
        description="No background work has been retried, dismissed, or changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
