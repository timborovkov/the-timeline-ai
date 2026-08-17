'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Background jobs' }]} />
      <PageHeader
        title="Background jobs"
        subtitle="Retry or dismiss failed processing from the last 7 days."
      />
      <ErrorState
        title="Unable to load background jobs"
        description="No background work has been retried, dismissed, or changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
