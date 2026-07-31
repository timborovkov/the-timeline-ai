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

        <section aria-label="Search loading placeholder" className="space-y-5">
          <div className="h-11 rounded-sm border border-border bg-surface px-3 py-3">
            <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
          </div>
          <div className="flex flex-wrap gap-2 border-y border-border py-3">
            <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-9 w-28 motion-reduce:animate-none" />
          </div>
          <div className="overflow-hidden rounded-sm border border-border bg-bg">
            <div className="border-b border-border px-3 py-2">
              <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
            </div>
            <div className="space-y-3 px-3 py-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2 border-b border-border pb-3 last:border-b-0">
                  <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
