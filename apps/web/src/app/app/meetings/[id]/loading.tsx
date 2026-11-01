import { HistoryBackLinkSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function MeetingLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading meeting
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading meeting">
        <div aria-hidden="true">
          <HistoryBackLinkSkeleton />
        </div>
        <h1 className="sr-only">Meeting</h1>
        <PageHeaderSkeleton action />
        <section aria-label="Meeting loading placeholder" className="space-y-5">
          <div className="space-y-2 border-y border-border py-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full max-w-2xl" />
            <Skeleton className="h-4 w-4/5 max-w-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <div className="space-y-3 border-y border-border py-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex gap-3">
                  <Skeleton className="h-3 w-12 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4 max-w-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
