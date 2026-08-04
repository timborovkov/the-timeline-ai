import { Breadcrumb } from '@/components/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuditLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading trust audit
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading trust audit"
      >
        <h1 className="sr-only">Trust audit</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Trust audit' }]} />
        <div aria-hidden="true" inert className="space-y-8">
          <div className="border-y border-border py-3">
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
          <section className="divide-y divide-border rounded-sm border border-border bg-surface text-sm">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,18rem)]"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Skeleton className="h-3 w-36 max-w-full" />
                    <Skeleton className="h-3 w-32 max-w-full" />
                  </div>
                  <Skeleton className="h-4 w-3/5 max-w-full" />
                  <Skeleton className="h-3 w-24 max-w-full" />
                </div>
                <Skeleton className="h-3 w-28 max-w-full sm:justify-self-end" />
                <div
                  data-loading-technical-details
                  className="border-t border-border pt-3 sm:col-span-2"
                >
                  <Skeleton className="h-4 w-32 max-w-full" />
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </>
  );
}
