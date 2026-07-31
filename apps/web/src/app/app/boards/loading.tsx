import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function BoardsLoading() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading boards
      </p>
      <div className="space-y-6" aria-busy="true">
        <PageHeaderSkeleton />
        <ul className="divide-y divide-border border border-border" aria-label="Loading boards">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-start justify-between gap-3 bg-bg px-4 py-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full max-w-lg" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-8 w-24" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
