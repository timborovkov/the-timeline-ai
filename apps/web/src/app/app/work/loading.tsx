'use client';

import { useSearchParams } from 'next/navigation';

import {
  ChipNavSkeleton,
  CollectionGroupSkeleton,
  CollectionRowSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
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
      <div
        data-app-width={isPinned ? 'collection' : 'overview'}
        className={isPinned ? 'space-y-6' : 'work-overview space-y-6'}
        aria-busy="true"
        aria-label="Loading work"
      >
        <h1 className="sr-only">Work</h1>
        <div aria-hidden="true">
          <PageHeaderSkeleton variant={isPinned ? 'collection' : undefined} />
        </div>
        <WorkSubnav current={current} />
        <div
          aria-hidden="true"
          className={
            isPinned ? 'space-y-0' : 'grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]'
          }
          data-work-loading-view={isPinned ? 'pinned' : 'overview'}
        >
          {isPinned ? (
            <>
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-1.5 border-b border-border px-2 sm:px-3">
                <ChipNavSkeleton
                  count={7}
                  widths={['w-10', 'w-16', 'w-16', 'w-20', 'w-20', 'w-16', 'w-16']}
                />
                <Skeleton className="h-9 w-20" />
              </div>
              <div>
                {Array.from({ length: 6 }).map((_, index) => (
                  <CollectionRowSkeleton key={index} leading metadata={2} />
                ))}
              </div>
            </>
          ) : (
            <>
              <CollectionGroupSkeleton groups={1} rows={3} leading />
              <div className="space-y-6 border-t border-border pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
                <CollectionGroupSkeleton groups={1} rows={3} leading={false} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
