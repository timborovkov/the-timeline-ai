'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle="Manage members, defaults, and access." />
      <ErrorState
        title="Unable to load team settings"
        description="Your team members, access, and defaults have not changed. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
