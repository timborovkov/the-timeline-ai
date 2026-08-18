import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
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
          <PageHeaderSkeleton variant="collection" />
          <section className="space-y-3">
            <Skeleton className="h-10 w-full rounded-sm" />
          </section>
          <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-4 w-32 max-w-full" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-20 rounded-sm" />
              <Skeleton className="h-8 w-24 rounded-sm" />
              <Skeleton className="h-8 w-20 rounded-sm" />
            </div>
          </section>
          <section className="flex flex-wrap items-center gap-3 border-y border-border py-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24 rounded-sm" />
          </section>
          <section className="space-y-6">
            <section>
              <h2 className="sr-only">Folders</h2>
              <Skeleton className="mb-3 h-5 w-16" />
              <CollectionRowsSkeleton count={3} />
            </section>
            <section>
              <h2 className="sr-only">Documents</h2>
              <Skeleton className="mb-3 h-5 w-24" />
              <CollectionRowsSkeleton count={4} />
            </section>
          </section>
        </div>
      </div>
    </>
  );
}
