import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ClusterLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading reconciliation cluster
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading reconciliation cluster"
      >
        <h1 className="sr-only">Reconciliation cluster</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Reconciliation', href: '/app/team/reconciliation' },
            { label: 'Cluster' },
          ]}
        />

        <div aria-hidden="true" className="space-y-4">
          <PageHeaderSkeleton />
          <section aria-label="Reconciliation cluster loading placeholder" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <ClusterListSkeleton titleWidth="w-24" />
              <ClusterListSkeleton titleWidth="w-20" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ClusterListSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="space-y-3">
      <Skeleton className={`h-5 ${titleWidth}`} />
      <div className="divide-y divide-border border-y border-border bg-surface">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex min-h-11 items-center gap-3 px-3">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-4 w-3/5 max-w-full" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
