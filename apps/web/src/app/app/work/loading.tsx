'use client';

import { useSearchParams } from 'next/navigation';

import { PageHeaderSkeleton } from '@/components/loading-states';
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
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current={current} />
        <div
          aria-hidden="true"
          className="space-y-7"
          data-work-loading-view={isPinned ? 'pinned' : 'overview'}
        >
          {isPinned ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-9 w-24" />
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 7 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-20" />
                ))}
              </div>
              <div className="overflow-hidden border border-border">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 border-b border-border bg-bg p-3 last:border-b-0"
                  >
                    <Skeleton className="size-8 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                    <Skeleton className="h-8 w-8 shrink-0" />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <section className="space-y-3">
                <Skeleton className="h-5 w-24" />
                <div className="overflow-hidden border border-border">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="space-y-2 border-b border-border bg-bg p-3 last:border-b-0"
                    >
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-3">
                <Skeleton className="h-5 w-44" />
                <div className="grid gap-px overflow-hidden border border-border">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="space-y-2 bg-bg p-3">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
