import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function EntityLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading object
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading object">
        <h1 className="sr-only">Object</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects" />
        <div
          aria-hidden="true"
          inert
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]"
        >
          <section className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </section>
          <aside className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </aside>
        </div>
      </div>
    </>
  );
}
