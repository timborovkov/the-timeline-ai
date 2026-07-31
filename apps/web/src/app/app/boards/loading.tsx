import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

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
            <ul className="divide-y divide-border border border-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="bg-bg">
                  <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-40 max-w-full motion-reduce:animate-none" />
                      <Skeleton className="h-3 w-full max-w-lg motion-reduce:animate-none" />
                      <Skeleton className="h-3 w-48 max-w-full motion-reduce:animate-none" />
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-start">
                      <Skeleton className="h-3 w-16 motion-reduce:animate-none" />
                      <Skeleton className="h-8 w-8 rounded-sm motion-reduce:animate-none" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
