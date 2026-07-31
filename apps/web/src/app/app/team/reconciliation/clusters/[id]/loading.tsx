import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ClusterLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading reconciliation cluster
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading reconciliation cluster">
        <h1 className="sr-only">Reconciliation cluster</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Reconciliation', href: '/app/team/reconciliation' },
            { label: 'Cluster' },
          ]}
        />
        <PageHeaderSkeleton />

        <section aria-label="Reconciliation cluster loading placeholder" className="space-y-4">
          <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <ClusterSummarySkeleton />
            <ClusterActionSkeleton />
          </div>
          <div aria-hidden="true" className="grid gap-4 xl:grid-cols-2">
            <ClusterListSkeleton titleWidth="w-24" />
            <ClusterListSkeleton titleWidth="w-20" />
          </div>
        </section>
      </div>
    </>
  );
}

function ClusterSummarySkeleton() {
  return (
    <div className="space-y-4 rounded-sm border border-border bg-surface p-4">
      <Skeleton className="h-4 w-44 max-w-full" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-36" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function ClusterActionSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface p-4">
      <Skeleton className="h-5 w-36 max-w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-9 w-36 max-w-full" />
    </div>
  );
}

function ClusterListSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="space-y-3">
      <Skeleton className={`h-5 ${titleWidth}`} />
      <div className="divide-y divide-border rounded-sm border border-border bg-surface">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3 p-3">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-3/4 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
