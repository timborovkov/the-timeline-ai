'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function TimelineError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <PageHeader title="Timeline" subtitle="Review captured event history and cited evidence." />
      <ErrorState
        title="Unable to load timeline"
        description="Your event history has not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
