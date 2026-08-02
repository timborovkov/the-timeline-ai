import { PageHeaderSkeleton, TimelineFeedSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TimelineLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading timeline
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading timeline page">
        <h1 className="sr-only">Timeline</h1>
        <PageHeaderSkeleton />
        <section aria-label="Timeline loading placeholder" className="space-y-3">
          <Skeleton className="h-10 w-full rounded-sm" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-5 w-20" />
          </div>
          <TimelineFeedSkeleton count={6} />
        </section>
      </div>
    </>
  );
}
