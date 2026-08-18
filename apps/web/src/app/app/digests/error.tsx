'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

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
        title="Digests"
        subtitle="Browse every daily digest and open a specific day."
      />
      <WorkSubnav current="/app/digests" />
      <ErrorState
        title="Unable to load digests"
        description="Saved daily digests have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
