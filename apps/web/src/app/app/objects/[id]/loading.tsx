import { CardSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectDetailLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading object
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading object">
        <h1 className="sr-only">Object</h1>
        <PageHeaderSkeleton />
        <WorkSubnav current="/app/objects" />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section aria-label="Object detail loading placeholder" className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </section>
          <aside aria-label="Object fields loading placeholder" className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </aside>
        </div>
      </div>
    </>
  );
}
