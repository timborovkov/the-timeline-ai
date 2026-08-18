'use client';

import { useSearchParams } from 'next/navigation';

import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function TasksLoading() {
  const searchParams = useSearchParams();
  const isKanban = searchParams.get('view') === 'kanban';

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
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/tasks" className="shrink-0 px-4 md:px-8" />
        <div
          aria-hidden="true"
          inert
          className="shrink-0 border-y border-border bg-bg/80 px-2 py-3 sm:px-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-48 flex-1 sm:max-w-sm">
              <Skeleton className="h-9 w-56" />
            </div>
            <Skeleton className="h-9 w-20" />
            <Skeleton className="ml-auto h-9 w-32" />
          </div>
        </div>
        <div
          aria-hidden="true"
          inert
          data-tasks-loading-view={isKanban ? 'kanban' : 'list'}
          className="flex min-h-0 flex-1 flex-col"
        >
          {isKanban ? (
            <section className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-2 pb-4 sm:px-3">
              {Array.from({ length: 5 }).map((_, col) => (
                <div
                  key={col}
                  className="flex w-[min(260px,calc(100vw-2.5rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-2"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-6" />
                  </div>
                  <div className="space-y-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="rounded-sm border border-border bg-bg px-2 py-1.5">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="mt-1 h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">
              {Array.from({ length: 2 }).map((_, group) => (
                <section key={group}>
                  <div className="flex min-h-10 items-center gap-2 border-y border-border bg-surface/70 px-2 sm:px-3">
                    <Skeleton className="h-3.5 w-3.5" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-6" />
                  </div>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="flex min-h-11 items-center gap-3 border-b border-border px-2 sm:px-3"
                    >
                      <Skeleton className="size-4 shrink-0" />
                      <Skeleton className="h-4 w-2/5" />
                      <div className="ml-auto flex items-center gap-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 w-14" />
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
