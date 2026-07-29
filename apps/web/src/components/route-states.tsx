import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export function RouteLoading({
  rows = 4,
  label = 'Loading page',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label={label}>
      <PageHeaderSkeleton />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="mt-3 h-3 w-4/5" />
            <Skeleton className="mt-2 h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
