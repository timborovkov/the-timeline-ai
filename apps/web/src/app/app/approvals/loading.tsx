import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function ApprovalsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading approvals
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading approvals">
        <h1 className="sr-only">Approvals</h1>
        <PageHeaderSkeleton />
        <WorkSubnav current="/app/approvals" />
        <section aria-label="Approvals loading placeholder" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-20 rounded-sm" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, bundleIndex) => (
              <div key={bundleIndex} className="border-t border-border py-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-5 w-2/5" />
                <div className="mt-3 space-y-3 border border-border bg-bg p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-16 rounded-sm" />
                    <Skeleton className="h-8 w-16 rounded-sm" />
                    <Skeleton className="h-8 w-16 rounded-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
