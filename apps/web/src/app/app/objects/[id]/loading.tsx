import { HairlineSectionSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectDetailLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading object
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading object"
      >
        <h1 className="sr-only">Object</h1>
        <div aria-hidden="true" inert>
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects" />
        <div
          aria-hidden="true"
          inert
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]"
        >
          <section className="space-y-3">
            <HairlineSectionSkeleton />
            <HairlineSectionSkeleton lines={4} />
            <HairlineSectionSkeleton />
          </section>
          <aside className="space-y-3">
            <HairlineSectionSkeleton lines={2} />
            <HairlineSectionSkeleton lines={2} />
          </aside>
        </div>
      </div>
    </>
  );
}
