import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function MergeObjectsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading merge objects
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading merge objects">
        <h1 className="sr-only">Merge objects</h1>
        <PageHeaderSkeleton />
        <WorkSubnav current="/app/objects/merge" />
        <section aria-label="Object merge loading placeholder" className="space-y-6">
          <div className="grid gap-px overflow-hidden border border-border">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="bg-bg px-3 py-2.5">
                <div className="flex min-h-7 items-center gap-3">
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-3 w-8" />
                </div>
                <div className="mt-2 border-t border-border/70 pt-2">
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
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
    </>
  );
}
