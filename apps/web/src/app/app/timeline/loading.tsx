import { PageHeaderSkeleton, TimelineFeedSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TimelineLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <Skeleton className="h-10 w-full rounded-sm" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-5 w-20" />
        </div>
        <TimelineFeedSkeleton count={6} />
      </div>
    </div>
  );
}
