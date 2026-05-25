import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function BoardsLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <section className="rounded-sm border border-border bg-surface p-4">
        <Skeleton className="mb-3 h-3 w-24" />
        <Skeleton className="h-10 w-full" />
      </section>
      <ul
        className="grid grid-cols-1 gap-px overflow-hidden border border-border sm:grid-cols-2"
        aria-label="Loading boards"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between bg-bg px-3 py-2.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}
