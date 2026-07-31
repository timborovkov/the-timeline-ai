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
        className="flex h-[calc(100dvh-10rem)] flex-col"
        aria-busy="true"
        aria-label="Loading tasks"
      >
        <h1 className="sr-only">Tasks</h1>
        <div className="mb-5 shrink-0">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/tasks" className="mb-5 shrink-0" />
        <section
          aria-label="Task board loading placeholder"
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto"
        >
          {Array.from({ length: 5 }).map((_, col) => (
            <div
              key={col}
              className="flex w-[280px] shrink-0 flex-col rounded-sm border border-border bg-surface p-3"
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
    </>
  );
}
