import { PageHeaderSkeleton, TimelineFeedSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TimelineLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeaderSkeleton />
      <div className="rounded-sm border border-border bg-surface p-4">
        <Skeleton className="mb-3 h-3 w-20" />
        <Skeleton className="mb-3 h-4 w-72" />
        <Skeleton className="h-24 w-full" />
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <Skeleton className="h-6 w-28 rounded-sm" />
          <Skeleton className="h-8 w-20 rounded-sm" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-sm" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-20" />
        </div>
        <TimelineFeedSkeleton count={4} />
      </div>
    </div>
  );
}
