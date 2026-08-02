'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        subtitle="Search pages, workspace objects, tasks, boards, calendar, timeline events, and documents."
      />
      <ErrorState
        title="Unable to load search"
        description="Your query and filters have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
