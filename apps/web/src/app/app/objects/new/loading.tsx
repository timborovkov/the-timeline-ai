import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function NewObjectLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading new object
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading new object"
      >
        <h1 className="sr-only">New object</h1>
        <div aria-hidden="true" inert>
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects/new" />
        <section aria-hidden="true" inert className="max-w-xl space-y-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-sm" />
              {index === 2 ? <Skeleton className="h-3 w-3/5" /> : null}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
