import { Breadcrumb } from '@/components/breadcrumb';
import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function IntegrationsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading team integrations
      </output>
      <div className="space-y-8" aria-busy="true" aria-label="Loading team integrations">
        <h1 className="sr-only">Team integrations</h1>
        <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Integrations' }]} />
        <PageHeaderSkeleton />

        <div
          aria-hidden="true"
          className="flex flex-wrap items-center gap-2 border-y border-border py-2"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-28 max-w-full" />
          ))}
        </div>

        <section aria-label="Team integrations loading placeholder" className="space-y-8">
          <IntegrationSectionSkeleton cards={2} />
          <IntegrationSectionSkeleton cards={3} grid />
          <IntegrationSectionSkeleton cards={2} />
        </section>
      </div>
    </>
  );
}

function IntegrationSectionSkeleton({ cards, grid = false }: { cards: number; grid?: boolean }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-5 w-52 max-w-full" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div className={grid ? undefined : 'space-y-3'}>
        {grid ? (
          <CollectionRowsSkeleton count={cards} />
        ) : (
          Array.from({ length: cards }).map((_, index) => (
            <div key={index} className="space-y-3 border-y border-border py-4">
              <Skeleton className="h-4 w-2/5 max-w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5 max-w-full" />
              <Skeleton className="h-8 w-28 max-w-full" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
