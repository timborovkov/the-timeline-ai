'use client';

import { useSearchParams } from 'next/navigation';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { WorkSubnav } from '@/components/work-subnav';

export default function WorkError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const searchParams = useSearchParams();
  const isPinned = searchParams.get('view') === 'pinned';
  const current = isPinned ? '/app/work?view=pinned' : '/app/work';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work"
        subtitle={
          isPinned
            ? 'Personal shortcuts to the work and context you return to.'
            : 'Prioritized work that needs a decision, owner, or next action.'
        }
      />
      <WorkSubnav current={current} />
      <ErrorState
        title="Unable to load work"
        description="Your saved work queue, pins, and board state are unchanged. Check your connection, then try again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
