import { CollectionRowSkeleton, CollectionToolbarSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function SearchLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading search
      </output>
      <div className="space-y-5" aria-busy="true" aria-label="Loading search">
        <header className="space-y-2">
          <h1 className="sr-only">Search</h1>
          <Skeleton className="h-7 w-24 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full max-w-2xl motion-reduce:animate-none" />
        </header>

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
