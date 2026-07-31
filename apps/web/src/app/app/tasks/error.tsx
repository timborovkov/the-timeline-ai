'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" subtitle="Assigned work and follow-ups from your timeline." />
      <WorkSubnav current="/app/tasks" />
      <ErrorState
        title="Unable to load tasks"
        description="Tasks could not be loaded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
