import { HistoryBackLinkSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { MergeObjectRowsSkeleton } from '@/components/objects/merge-object-rows-skeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function MergeObjectsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading merge objects
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading merge objects"
      >
        <h1 className="sr-only">Merge objects</h1>
        <div aria-hidden="true" inert className="space-y-2">
          <HistoryBackLinkSkeleton />
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects/merge" />
        <div aria-hidden="true" inert>
          <section className="space-y-6">
            <MergeObjectRowsSkeleton />
            <div className="space-y-3 border-y border-border py-4">
              <Skeleton className="h-3 w-24" />
              <div className="grid gap-px overflow-hidden border border-border sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="space-y-2 bg-bg px-3 py-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-8" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
