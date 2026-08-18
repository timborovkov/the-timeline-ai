import { Breadcrumb } from '@/components/breadcrumb';
import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function PersonalConnectionsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading provider accounts
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading provider accounts">
        <h1 className="sr-only">Provider accounts</h1>
        <Breadcrumb
          items={[{ label: 'Connections', href: '/app/sources' }, { label: 'Provider accounts' }]}
        />
        <div aria-hidden="true" className="space-y-8">
          <PageHeaderSkeleton />
          <div className="flex flex-wrap gap-2 border-y border-border py-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-7 w-40" />
          </div>
          <section className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <div className="border-y border-border py-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
          </section>
          <section className="space-y-3">
            <Skeleton className="h-5 w-56" />
            <CollectionRowsSkeleton count={3} />
          </section>
        </div>
      </div>
    </>
  );
}
