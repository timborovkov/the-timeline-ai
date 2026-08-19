import {
  CollectionRowSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
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
        <PageHeaderSkeleton variant="collection" />
        <nav aria-label="Loading meeting views" className="flex gap-1 border-b border-border">
          <Skeleton className="h-9 w-20 rounded-t-sm" />
          <Skeleton className="h-9 w-16 rounded-t-sm" />
        </nav>
        <section
          aria-label="Meeting setup loading placeholder"
          className="space-y-3 border-y border-border py-4"
        >
          <Skeleton className="h-5 w-44 max-w-full" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-full max-w-xl" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-9 w-full rounded-sm" />
              <Skeleton className="h-9 w-full rounded-sm" />
            </div>
            <Skeleton className="h-9 w-32 rounded-sm" />
          </div>
        </section>
        <section aria-label="Meeting search controls loading placeholder">
          <CollectionToolbarSkeleton />
        </section>
        <section aria-label="Meeting captures loading placeholder">
          <ul>
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index}>
                <CollectionRowSkeleton subtitle metadata={2} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
