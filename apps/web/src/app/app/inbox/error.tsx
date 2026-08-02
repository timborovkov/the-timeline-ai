'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Inbox"
        subtitle="Review notifications and changes that need your attention."
      />
      <ErrorState
        title="Unable to load inbox"
        description="Your notifications and read status have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
