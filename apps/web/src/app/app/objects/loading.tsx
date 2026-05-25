import { EntityGridSkeleton } from '@/components/loading-states';
import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function ObjectsLoading() {
  return (
    <NarrowContainer>
      <header className="mb-10 flex items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </header>

      <nav className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-16 rounded-full" />
        ))}
      </nav>

      <div className="space-y-10">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-6" />
          </div>
          <EntityGridSkeleton count={6} />
        </section>
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-6" />
          </div>
          <EntityGridSkeleton count={4} />
        </section>
      </div>
    </NarrowContainer>
  );
}
