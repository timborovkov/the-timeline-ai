import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function WorkLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading work
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading work">
        <h1 className="sr-only">Work</h1>
        <PageHeaderSkeleton />
        <section
          aria-label="Work loading placeholder"
          className="overflow-hidden border border-border"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2 border-b border-border bg-bg p-3 last:border-b-0">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
