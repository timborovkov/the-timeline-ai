import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Matches the DocumentDrive layout in Design v2: index strip header,
 * action row, and flat indexed rows for folders + documents. Mirrors
 * the loading shape PR #20 + PR #23 established for every other route
 * so navigation never flashes a blank screen.
 */
export default function DocumentsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-2">
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
                <Skeleton className="h-4 w-48" />
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
                className="flex items-center justify-between rounded-sm border border-border bg-card px-3 py-2"
              >
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-16" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
