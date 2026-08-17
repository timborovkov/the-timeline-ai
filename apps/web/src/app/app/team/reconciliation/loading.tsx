import { Breadcrumb } from '@/components/breadcrumb';
import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReconciliationLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading reconciliation
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading reconciliation">
        <h1 className="sr-only">Reconciliation</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Reconciliation' }]} />
        <PageHeaderSkeleton showMetadata={false} />

        <section aria-label="Reconciliation loading placeholder" className="space-y-8">
          <div
            aria-hidden="true"
            className="flex flex-col gap-2 border-y border-border px-2 py-2 sm:px-3 md:flex-row md:items-center md:justify-end"
          >
            <Skeleton className="h-3 w-48 max-w-full md:mr-auto" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-32" />
          </div>
          <RecentReconciliationSkeleton />
          <AdvancedToolsSkeleton />
        </section>
      </div>
    </>
  );
}

function RecentReconciliationSkeleton() {
  return (
    <section aria-hidden="true" className="space-y-4">
      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="space-y-3">
            <Skeleton className="h-4 w-32 max-w-full" />
            <div className="divide-y divide-border border-y border-border bg-surface">
              {Array.from({ length: 3 }).map((_, rowIndex) => (
                <div key={rowIndex} className="flex min-h-11 items-center gap-3 px-3">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-4 w-2/5 max-w-full" />
                  <Skeleton className="ml-auto h-3 w-16" />
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
      className="border-t border-border pt-3"
    >
      <Skeleton className="h-4 w-32 max-w-full" />
    </div>
  );
}
