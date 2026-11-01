import {
  CollectionRowSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';

export default function SearchLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading search
      </output>
      <div className="space-y-5" aria-busy="true" aria-label="Loading search">
        <h1 className="sr-only">Search</h1>
        <div aria-hidden="true">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <section
          aria-hidden="true"
          className="space-y-0 motion-reduce:animate-none"
          data-testid="search-loading-visuals"
        >
          <CollectionToolbarSkeleton />
          <div>
            {Array.from({ length: 3 }).map((_, index) => (
              <CollectionRowSkeleton key={index} subtitle metadata={2} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
