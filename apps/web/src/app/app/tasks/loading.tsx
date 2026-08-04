import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function TasksLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading tasks
      </output>
      <div
        data-app-layout="full-bleed"
        className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8"
        aria-busy="true"
        aria-label="Loading tasks"
      >
        <h1 className="sr-only">Tasks</h1>
        <div aria-hidden="true" inert className="shrink-0 px-4 pt-5 md:px-8">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/tasks" className="shrink-0 px-4 md:px-8" />
        <div
          aria-hidden="true"
          inert
          className="shrink-0 border-y border-border bg-bg/80 px-4 py-3 md:px-8"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-9 w-56" />
            </div>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="space-y-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-9 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div
          aria-hidden="true"
          inert
          className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 md:px-8"
        >
          <section className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
            {Array.from({ length: 5 }).map((_, col) => (
              <div
                key={col}
                className="flex w-[min(290px,calc(100vw-4rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-3"
              >
                <div className="mb-3 flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-6" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-sm border border-border bg-bg px-3 py-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="mt-1.5 h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
