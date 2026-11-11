import {
  CollectionRowSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function CalendarLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading calendar
      </output>
      <div
        data-app-width="collection"
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading calendar"
      >
        <h1 className="sr-only">Calendar</h1>
        <div aria-hidden="true" inert>
          <PageHeaderSkeleton variant="collection" showMetadata={false} />
        </div>
        <WorkSubnav current="/app/calendar" spacing="comfortable" />
        <div aria-hidden="true" inert>
          <div className="space-y-4">
            <section className="space-y-4" aria-label="Calendar loading placeholder">
              <div className="flex min-h-11 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-44 motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-28 motion-reduce:animate-none" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-sm bg-surface">
                    <Skeleton className="h-8 w-14 rounded-none motion-reduce:animate-none" />
                    <Skeleton className="h-8 w-14 rounded-none motion-reduce:animate-none" />
                    <Skeleton className="h-8 w-12 rounded-none motion-reduce:animate-none" />
                  </div>
                  <Skeleton className="h-8 w-36 motion-reduce:animate-none" />
                  <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
                  {Array.from({ length: 56 }).map((_, index) => (
                    <div
                      key={index}
                      className={`${index % 8 === 0 ? 'hidden sm:block ' : ''}${index < 8 ? 'h-6 bg-surface-2 sm:h-8' : 'min-h-7 bg-bg p-1 sm:min-h-28 sm:p-2'}`}
                    >
                      {index >= 8 ? (
                        <Skeleton className="h-3 w-3 motion-reduce:animate-none" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-border">
                <CollectionToolbarSkeleton viewSegments={3} filters={false} />
                <div>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <CollectionRowSkeleton key={index} subtitle metadata={2} />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
