import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function MeetingsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading meetings
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading meetings"
      >
        <h1 className="sr-only">Meetings</h1>
        <PageHeaderSkeleton />
        <nav aria-label="Loading meeting views" className="flex gap-1 border-b border-border">
          <Skeleton className="h-9 w-20 rounded-t-sm" />
          <Skeleton className="h-9 w-16 rounded-t-sm" />
        </nav>
        <section aria-label="Meeting setup loading placeholder" className="space-y-3">
          <Skeleton className="h-5 w-44 max-w-full" />
          <div className="space-y-4 rounded-sm border border-border bg-surface p-4 sm:p-5">
            <Skeleton className="h-4 w-full max-w-xl" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-9 w-full rounded-sm" />
              <Skeleton className="h-9 w-full rounded-sm" />
            </div>
            <Skeleton className="h-9 w-32 rounded-sm" />
          </div>
        </section>
        <section
          aria-label="Meeting search controls loading placeholder"
          className="grid gap-3 border-y border-border py-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full rounded-sm" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full rounded-sm" />
          </div>
          <Skeleton className="h-9 w-20 rounded-sm" />
        </section>
        <section aria-label="Meeting captures loading placeholder" className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <ul className="border-t border-border">
            {Array.from({ length: 4 }).map((_, index) => (
              <li
                key={index}
                className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0 space-y-2">
                  <Skeleton className="h-4 w-2/5 max-w-full" />
                  <Skeleton className="h-3 w-3/5 max-w-full" />
                </div>
                <div className="flex gap-2 sm:justify-end">
                  <Skeleton className="h-6 w-20 rounded-sm" />
                  <Skeleton className="h-8 w-8 rounded-sm" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
