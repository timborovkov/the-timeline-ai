import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-6 py-8">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-80" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-8 w-56 rounded-full" />
          <Skeleton className="h-8 w-48 rounded-full" />
        </div>
      </div>
      <Skeleton className="mt-8 h-14 w-full rounded-xl" />
    </div>
  );
}
