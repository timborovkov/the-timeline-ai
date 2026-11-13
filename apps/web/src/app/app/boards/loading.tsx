import { CollectionRowSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function BoardsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading boards
      </output>
      <h1 className="sr-only">Boards</h1>
      <div
        data-app-width="collection"
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading boards"
      >
        <div aria-hidden="true">
          <PageHeaderSkeleton variant="collection" action />
        </div>
        <section aria-hidden="true" aria-label="Boards list loading placeholder">
          <div>
            {Array.from({ length: 3 }).map((_, index) => (
              <CollectionRowSkeleton key={index} subtitle metadata={3} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
