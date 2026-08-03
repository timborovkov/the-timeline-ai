import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function SourcesLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading connections
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading connections"
      >
        <h1 className="sr-only">Connections</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
          <section className="space-y-6">
            <SourceGroupSkeleton rows={2} />
            <SourceGroupSkeleton rows={3} />
            <SourceGroupSkeleton rows={2} />
          </section>
        </div>
      </div>
    </>
  );
}

function SourceGroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-40" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Skeleton className="mt-0.5 size-5 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-28 max-w-full" />
                <Skeleton className="h-3 w-full max-w-md" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
            <Skeleton className="h-8 w-28 shrink-0 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
