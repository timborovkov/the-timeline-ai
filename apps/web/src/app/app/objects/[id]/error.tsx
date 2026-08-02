'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Object" />
      <WorkSubnav current="/app/objects" />
      <ErrorState
        title="Unable to load object"
        description="Object details could not be loaded. Your saved object data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
