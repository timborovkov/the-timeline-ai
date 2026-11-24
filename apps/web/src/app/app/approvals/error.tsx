'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" subtitle="Review pending changes and see past decisions." />
      <ErrorState
        title="Unable to load approvals"
        description="Your pending approvals and saved decisions have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
