import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function DigestsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading digests
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading digests">
        <h1 className="sr-only">Digests</h1>
        <div aria-hidden="true" className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/digests" />
        <div aria-hidden="true" className="space-y-3 motion-reduce:[&_.animate-pulse]:animate-none">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 border-b border-border py-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/5 max-w-full" />
              <Skeleton className="ml-auto h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
