'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        subtitle="Review evidence-backed changes before they become team memory."
      />
      <WorkSubnav current="/app/approvals" />
      <ErrorState
        title="Unable to load approvals"
        description="No approval has been accepted, changed, or rejected. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
