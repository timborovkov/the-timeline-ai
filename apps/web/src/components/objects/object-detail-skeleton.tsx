import { HairlineSectionSkeleton } from '@/components/loading-states';

export function ObjectDetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      inert
      className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"
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
  );
}
