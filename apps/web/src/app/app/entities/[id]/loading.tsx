import { CardSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function EntityDetailLoading() {
  return (
    <div>
      <header className="mb-10 flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-wrap items-baseline gap-3">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-60" />
      </header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="space-y-4 md:col-span-2">
          <Skeleton className="h-4 w-20" />
          <CardSkeleton />
          <CardSkeleton />
          <Skeleton className="mt-6 h-4 w-32" />
          <CardSkeleton />
          <CardSkeleton />
        </section>
        <aside className="space-y-4">
          <div className="rounded-xl border bg-card p-6">
            <Skeleton className="mb-3 h-4 w-16" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
