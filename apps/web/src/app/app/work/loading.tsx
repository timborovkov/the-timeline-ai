'use client';

import { useSearchParams } from 'next/navigation';

import {
  CollectionGroupSkeleton,
  CollectionRowSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function WorkLoading() {
  const searchParams = useSearchParams();
  const isPinned = searchParams.get('view') === 'pinned';
  const current = isPinned ? '/app/work?view=pinned' : '/app/work';

  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading work
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading work">
        <h1 className="sr-only">Work</h1>
        <div aria-hidden="true">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current={current} />
        <div
          aria-hidden="true"
          className="space-y-7"
          data-work-loading-view={isPinned ? 'pinned' : 'overview'}
        >
          {isPinned ? (
            <>
              <CollectionToolbarSkeleton search={false} viewSegments={7} action />
              <div>
                {Array.from({ length: 6 }).map((_, index) => (
                  <CollectionRowSkeleton key={index} leading metadata={2} />
                ))}
              </div>
            </>
          ) : (
            <>
              <CollectionGroupSkeleton groups={1} rows={3} leading={false} />
              <CollectionGroupSkeleton groups={1} rows={4} leading={false} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
