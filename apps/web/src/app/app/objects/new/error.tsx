'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function NewObjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="New object" subtitle="Create a tracked object for your team." />
      <WorkSubnav current="/app/objects/new" />
      <ErrorState
        title="Unable to load object creation"
        description="The object creation form could not be loaded. No object has been created. Your saved object data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
