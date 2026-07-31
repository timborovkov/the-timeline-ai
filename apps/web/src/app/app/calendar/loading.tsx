import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function CalendarLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading calendar">
      <output className="sr-only">Loading calendar</output>
      <PageHeaderSkeleton />
      <WorkSubnav current="/app/calendar" />
      <section className="space-y-4" aria-label="Calendar loading placeholder">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px rounded-md border border-border bg-border sm:grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          {Array.from({ length: 32 }).map((_, index) => (
            <div
              key={index}
              className={index < 8 ? 'h-8 bg-muted/40' : 'min-h-28 bg-background p-2'}
            >
              {index >= 8 ? <Skeleton className="h-3 w-3/5" /> : null}
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-28" />
          <div className="mt-3 space-y-px border border-border bg-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="bg-background p-3">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="mt-2 h-3 w-2/5" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
