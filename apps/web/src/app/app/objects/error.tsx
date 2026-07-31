'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Objects"
        subtitle="Projects, people, decisions, and other durable team context."
      />
      <WorkSubnav current="/app/objects" />
      <ErrorState
        title="Unable to load objects"
        description="Objects could not be loaded. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
