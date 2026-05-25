import { EntityGridSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ObjectsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      <nav
        className="flex flex-wrap gap-1.5"
        aria-label="Loading object type filters"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-sm" />
        ))}
      </nav>
      <div className="space-y-8">
        {[6, 4].map((count, s) => (
          <section key={s}>
            <div className="mb-3 flex items-baseline justify-between border-b border-border pb-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-6" />
            </div>
            <EntityGridSkeleton count={count} />
          </section>
        ))}
      </div>
    </div>
  );
}
