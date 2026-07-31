'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function WorkError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Work" />
      <ErrorState
        title="Unable to load work"
        description="Work could not be loaded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
