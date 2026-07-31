'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function BoardsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title="Boards" />
      <WorkSubnav current="/app/boards" />
      <ErrorState
        title="Unable to load boards"
        description="Boards could not be loaded. Your saved board data is unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
