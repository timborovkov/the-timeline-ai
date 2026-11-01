import { Breadcrumb } from '@/components/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntegrationAuditLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading integration audit
      </output>
      <div
        className="space-y-8 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading integration audit"
      >
        <h1 className="sr-only">Integration audit</h1>
        <Breadcrumb
          items={[
            { label: 'Team', href: '/app/team' },
            { label: 'Integrations', href: '/app/team/integrations' },
            { label: 'Audit log' },
          ]}
        />
        <div aria-hidden="true" inert className="space-y-8">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-border py-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </header>
          <ul className="border-y border-border">
            {Array.from({ length: 5 }).map((_, index) => (
              <li key={index} className="space-y-2 border-b border-border py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-4 w-44 max-w-full" />
                  <Skeleton className="h-3 w-36 max-w-full" />
                </div>
                <Skeleton className="h-3 w-full max-w-2xl" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
