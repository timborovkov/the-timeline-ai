import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function BoardsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading boards
      </output>
      <h1 className="sr-only">Boards</h1>
      <div className="space-y-6" aria-busy="true" aria-label="Loading boards">
        <div aria-hidden="true">
          <PageHeaderSkeleton />
          <div className="flex gap-2 overflow-hidden py-1" aria-label="Work navigation placeholder">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-16 shrink-0 motion-reduce:animate-none" />
            ))}
          </div>
          <section aria-label="Boards list loading placeholder">
            <CollectionRowsSkeleton count={3} />
          </section>
        </div>
      </div>
    </>
  );
}
