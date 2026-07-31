'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function MergeObjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Merge objects"
        subtitle="Choose the object to keep, then merge duplicates into it."
      />
      <WorkSubnav current="/app/objects/merge" />
      <ErrorState
        title="Unable to load merge preview"
        description="The merge preview could not be loaded. No objects have been merged. Your saved object data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
