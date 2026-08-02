import { ObjectMergeRouteModalFrame } from '@/components/objects/object-merge-route-modal';
import { Skeleton } from '@/components/ui/skeleton';

export default function MergeObjectModalLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading merge preview
      </output>
      <ObjectMergeRouteModalFrame
        title="Review merge"
        description="Choose the object to keep, then merge the duplicate into it."
      >
        <div
          aria-hidden="true"
          inert
          className="space-y-5 motion-reduce:[&_.animate-pulse]:animate-none"
          aria-busy="true"
          aria-label="Loading merge preview"
        >
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
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      </ObjectMergeRouteModalFrame>
    </>
  );
}
