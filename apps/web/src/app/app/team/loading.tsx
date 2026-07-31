import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading team settings
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading team settings">
        <h1 className="sr-only">Team</h1>
        <PageHeaderSkeleton />
        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="min-w-0 lg:self-start">
            <nav
              aria-label="Team settings navigation loading placeholder"
              className="w-full max-w-full overflow-x-auto border-b border-border lg:w-52 lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-4"
            >
              <div aria-hidden="true" className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-9 w-20 shrink-0 motion-reduce:animate-none lg:w-full"
                  />
                ))}
              </div>
            </nav>
          </aside>
          <section
            aria-label="Team settings panels loading placeholder"
            className="min-w-0 flex-1 space-y-5"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="rounded-sm border border-border bg-surface"
              >
                <div className="p-5">
                  <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
                </div>
                <div className="space-y-2.5 px-5 pb-5">
                  <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-5/6 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
