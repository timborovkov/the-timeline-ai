import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
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
  );
}
