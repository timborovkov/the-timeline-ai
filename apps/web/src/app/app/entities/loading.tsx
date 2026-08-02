import { EntityGridSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function EntitiesLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading objects
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading objects">
        <h1 className="sr-only">Objects</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects" />
        <div aria-hidden="true" inert className="space-y-6">
          <nav className="flex flex-wrap gap-1.5">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-16 rounded-sm" />
            ))}
          </nav>
          <section className="space-y-8">
            {[6, 4].map((count, index) => (
              <div key={index}>
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-6" />
                </div>
                <EntityGridSkeleton count={count} />
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
