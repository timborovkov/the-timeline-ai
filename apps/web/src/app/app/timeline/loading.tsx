import { PageHeaderSkeleton, TimelineFeedSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TimelineLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-10 rounded-xl border bg-card p-6">
        <Skeleton className="mb-4 h-3 w-20" />
        <Skeleton className="mb-3 h-4 w-72" />
        <Skeleton className="h-24 w-full" />
        <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <Skeleton className="mb-8 h-11 w-full rounded-xl" />
      <div className="mt-10 space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-20" />
        </div>
        <TimelineFeedSkeleton count={4} />
      </div>
    </div>
  );
}
