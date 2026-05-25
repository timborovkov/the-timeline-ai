import { EntityGridSkeleton } from '@/components/loading-states';
import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

export default function BoardsLoading() {
  return (
    <NarrowContainer>
      <header className="mb-10 space-y-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-80" />
      </header>

      <div className="mb-10 rounded-xl border bg-card p-4">
        <Skeleton className="h-10 w-full" />
      </div>

      <EntityGridSkeleton count={4} />
    </NarrowContainer>
  );
}
