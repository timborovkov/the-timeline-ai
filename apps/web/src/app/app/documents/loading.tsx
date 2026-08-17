import { CollectionGroupSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading documents
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading documents"
      >
        <h1 className="sr-only">Documents</h1>
        <div className="space-y-6" aria-hidden="true" inert>
          <PageHeaderSkeleton />
          <section>
            <Skeleton className="h-10 w-full rounded-sm" />
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-4 w-32 max-w-full" />
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-8 w-20 rounded-sm" />
              <Skeleton className="h-8 w-24 rounded-sm" />
              <Skeleton className="h-8 w-20 rounded-sm" />
            </div>
          </section>
          <section className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24 rounded-sm" />
          </section>
          <section className="rounded-md border border-border bg-surface p-4">
            <CollectionGroupSkeleton groups={1} rows={3} leading />
            <CollectionGroupSkeleton groups={1} rows={4} leading subtitle />
          </section>
        </div>
      </div>
    </>
  );
}
