import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading documents">
      <PageHeaderSkeleton />
      <Skeleton className="h-10 w-full" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-7 w-28 rounded-sm" />
          <Skeleton className="h-7 w-24 rounded-sm" />
        </div>
      </div>
      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-6" />
          </div>
          <ul className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-sm border border-border bg-card px-3 py-2"
              >
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-full max-w-48" />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-6" />
          </div>
          <ul className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={i}
                className="grid gap-2 rounded-sm border border-border bg-card px-3 py-2 sm:grid-cols-[minmax(0,1fr)_4rem] sm:items-center"
              >
                <Skeleton className="h-4 w-full max-w-64" />
                <Skeleton className="h-3 w-16 sm:justify-self-end" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
