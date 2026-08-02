import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReconciliationLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading reconciliation
      </output>
      <div className="space-y-10" aria-busy="true" aria-label="Loading reconciliation">
        <h1 className="sr-only">Reconciliation</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Reconciliation' }]} />
        <PageHeaderSkeleton />

        <section aria-label="Reconciliation loading placeholder" className="space-y-10">
          <ReconciliationProcessSkeleton />
          <ReconciliationHealthSkeleton />
          <EvidenceSourceSkeleton />
          <RecentReconciliationSkeleton />
          <AdvancedToolsSkeleton />
        </section>
      </div>
    </>
  );
}

function ReconciliationProcessSkeleton() {
  return (
    <section aria-hidden="true" className="space-y-4">
      <Skeleton className="h-5 w-44 max-w-full" />
      <div className="grid overflow-hidden rounded-sm border border-border bg-surface md:grid-cols-3 md:divide-x md:divide-border">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="min-h-48 space-y-3 p-5">
            <Skeleton className="h-4 w-3/5 max-w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5 max-w-full" />
            <Skeleton className="mt-4 h-3 w-2/5 max-w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ReconciliationHealthSkeleton() {
  return (
    <section aria-hidden="true" className="space-y-4">
      <Skeleton className="h-5 w-36 max-w-full" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-44 w-full rounded-sm" />
        <Skeleton className="h-44 w-full rounded-sm" />
      </div>
      <div className="grid divide-y divide-border rounded-sm border border-border bg-surface sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-3 p-4">
            <Skeleton className="h-3 w-3/5 max-w-full" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceSourceSkeleton() {
  return (
    <section aria-hidden="true" className="space-y-4">
      <Skeleton className="h-5 w-40 max-w-full" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div className="overflow-x-auto rounded-sm border border-border bg-surface">
        <div className="min-w-[640px] divide-y divide-border p-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="grid grid-cols-6 gap-3 py-2">
              <Skeleton className="h-4 w-full" />
              {Array.from({ length: 5 }).map((_, cellIndex) => (
                <Skeleton key={cellIndex} className="h-4 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentReconciliationSkeleton() {
  return (
    <section aria-hidden="true" className="space-y-4">
      <Skeleton className="h-5 w-44 max-w-full" />
      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="h-4 w-32 max-w-full" />
            <div className="divide-y divide-border rounded-sm border border-border bg-surface">
              {Array.from({ length: 3 }).map((_, rowIndex) => (
                <div key={rowIndex} className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/5 max-w-full" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdvancedToolsSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-loading-section="advanced-tools"
      className="flex items-center justify-between gap-4 rounded-sm border border-border bg-surface px-4 py-3"
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
      <Skeleton className="size-4 shrink-0" />
    </div>
  );
}
