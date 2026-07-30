import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-describedby="team-loading-status">
      <output id="team-loading-status" aria-label="Loading team settings" className="sr-only">
        Loading team settings
      </output>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex gap-2 overflow-hidden border-b border-border pb-2 md:w-52 md:flex-col md:border-r md:border-b-0 md:pr-4 md:pb-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20 shrink-0 md:w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-sm border border-border bg-surface">
              <div className="p-5">
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="space-y-2.5 px-5 pb-5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
