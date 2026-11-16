import { HairlineSectionSkeleton } from '@/components/loading-states';

export function ObjectDetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      inert
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <section className="space-y-8">
        <HairlineSectionSkeleton />
        <HairlineSectionSkeleton lines={4} />
        <HairlineSectionSkeleton />
      </section>
      <aside className="space-y-8">
        <HairlineSectionSkeleton lines={2} />
        <HairlineSectionSkeleton lines={2} />
      </aside>
    </div>
  );
}
