import { EntityGridSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading objects
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading objects">
        <h1 className="sr-only">Objects</h1>
        <PageHeaderSkeleton />
        <WorkSubnav current="/app/objects" />
        <nav className="flex flex-wrap gap-1.5" aria-label="Loading object type filters">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-16 rounded-sm" />
          ))}
        </nav>
        <section aria-label="Object list loading placeholder" className="space-y-8">
          {[6, 4].map((count, s) => (
            <div key={s}>
              <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-6" />
              </div>
              <EntityGridSkeleton count={count} />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
