'use client';

import { Breadcrumb } from '@/components/breadcrumb';
import { ErrorState } from '@/components/error-state';
import { IndexStrip } from '@/components/index-strip';

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
      <IndexStrip segments={[{ value: 'BACKGROUND JOBS' }]} srLabel="Background jobs" />
      <ErrorState
        title="Unable to load background jobs"
        description="No background work has been retried, dismissed, or changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
