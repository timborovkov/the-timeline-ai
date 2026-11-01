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
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                  <CollectionRowSkeleton key={index} leading metadata={2} />
                ))}
              </section>
              <CollectionGroupSkeleton groups={1} rows={3} leading={false} />
              <CollectionGroupSkeleton groups={1} rows={4} leading={false} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
