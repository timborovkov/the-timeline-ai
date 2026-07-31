import { Breadcrumb } from '@/components/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuditLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading trust audit
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading trust audit">
        <h1 className="sr-only">Trust audit</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Trust audit' }]} />
        <div aria-hidden="true" className="border-y border-border py-3">
          <Skeleton className="h-4 w-full max-w-xl motion-reduce:animate-none" />
        </div>
        <section
          aria-label="Trust audit loading placeholder"
          className="divide-y divide-border rounded-sm border border-border bg-surface text-sm"
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} aria-hidden="true" className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-3 w-32 max-w-full motion-reduce:animate-none" />
                  <Skeleton className="h-3 w-36 max-w-full motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-4 w-3/5 max-w-full motion-reduce:animate-none" />
                <Skeleton className="h-3 w-24 max-w-full motion-reduce:animate-none" />
                <div
                  aria-hidden="true"
                  data-loading-technical-details
                  className="border-t border-border pt-3"
                >
                  <Skeleton className="h-4 w-32 max-w-full motion-reduce:animate-none" />
                </div>
              </div>
              <Skeleton className="h-3 w-28 max-w-full motion-reduce:animate-none sm:justify-self-end" />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
