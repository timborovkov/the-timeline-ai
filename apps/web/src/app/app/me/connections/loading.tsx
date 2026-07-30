import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function PersonalConnectionsLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading provider accounts">
      <p role="status" className="sr-only">
        Loading provider accounts
      </p>
      <Skeleton aria-hidden="true" className="h-3 w-28" />
      <PageHeaderSkeleton />
      <section aria-hidden="true" className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      </section>
      <section aria-hidden="true" className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </section>
    </div>
  );
}
