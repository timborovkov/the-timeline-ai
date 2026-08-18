import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
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
        <div aria-hidden="true" inert>
          <PageHeaderSkeleton variant="collection" />
          <div className="mt-6 space-y-6">
            <div>
              <Skeleton className="mb-2 h-4 w-32" />
              <CollectionRowsSkeleton count={3} />
            </div>
            <div>
              <Skeleton className="mb-2 h-4 w-40" />
              <CollectionRowsSkeleton count={2} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
