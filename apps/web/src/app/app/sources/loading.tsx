import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

function ConnectionsRowSkeleton({ description = false }: { description?: boolean }) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-border/80 px-2 sm:px-3">
      <Skeleton className="size-7 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-4 w-28" />
        {description ? <Skeleton className="h-3 w-48 max-w-full sm:hidden" /> : null}
      </div>
      <Skeleton className="hidden h-3 w-24 sm:block" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-5 w-12" />
    </div>
  );
}

function ConnectionsGroupSkeleton({
  rows,
  description = false,
}: {
  rows: number;
  description?: boolean;
}) {
  return (
    <section>
      <div className="flex min-h-10 items-center gap-2 border-y border-border bg-surface/70 px-2 sm:px-3">
        <Skeleton className="size-3.5" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-5" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <ConnectionsRowSkeleton key={index} description={description} />
      ))}
    </section>
  );
}

export default function SourcesLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading connections
      </output>
      <div
        className="space-y-4 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading connections"
      >
        <h1 className="sr-only">Connections</h1>
        <div aria-hidden="true" inert className="space-y-4">
          <PageHeaderSkeleton variant="collection" />
          <div className="flex flex-col gap-2 border-b border-border sm:flex-row sm:items-end sm:justify-between">
            <div className="flex gap-1 py-1">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
            <Skeleton className="mb-1.5 h-8 w-full sm:w-56" />
          </div>
          <div className="[&>section+section]:-mt-px">
            <ConnectionsGroupSkeleton rows={3} />
            <ConnectionsGroupSkeleton rows={4} description />
          </div>
        </div>
      </div>
    </>
  );
}
