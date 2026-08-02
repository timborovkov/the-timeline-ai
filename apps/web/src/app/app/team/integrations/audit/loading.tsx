import { Breadcrumb } from '@/components/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntegrationAuditLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading integration audit
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading integration audit">
        <h1 className="sr-only">Integration audit</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Integrations', href: '/app/team/integrations' },
            { label: 'Audit log' },
          ]}
        />
        <div aria-hidden="true" className="border-y border-border py-3">
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <section
          aria-label="Integration audit loading placeholder"
          className="divide-y divide-border rounded-sm border border-border bg-surface"
        >
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} aria-hidden="true" className="space-y-3 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3 w-36 max-w-full" />
              </div>
              <Skeleton className="h-3 w-full max-w-2xl" />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
