import { CollectionRowSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function HomeLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Home
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading Home">
        <h1 className="sr-only">Home</h1>
        <section aria-label="Home loading placeholder" className="space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <div className="border border-border">
              <Skeleton className="h-10 w-full rounded-none" />
            </div>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 py-3 sm:px-3">
                <Skeleton className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5 max-w-full" />
                  <Skeleton className="h-3 w-2/3 max-w-full sm:hidden" />
                </div>
                <Skeleton className="hidden h-3 w-28 shrink-0 sm:block" />
                <Skeleton className="size-4 shrink-0" />
              </div>
            ))}
          </div>
          <div>
            {Array.from({ length: 5 }).map((_, index) => (
              <CollectionRowSkeleton key={index} leading={false} metadata={0} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
