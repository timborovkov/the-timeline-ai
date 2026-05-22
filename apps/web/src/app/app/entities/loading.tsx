import { EntityGridSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function EntitiesLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-10">
        {[6, 4].map((count, i) => (
          <section key={i}>
            <div className="mb-3 flex items-baseline justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-6" />
            </div>
            <EntityGridSkeleton count={count} />
          </section>
        ))}
      </div>
    </div>
  );
}
