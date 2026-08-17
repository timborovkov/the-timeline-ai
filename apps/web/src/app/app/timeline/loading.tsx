import { CollectionToolbarSkeleton, TimelineFeedSkeleton } from '@/components/loading-states';

export default function TimelineLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading timeline
      </output>
      <div className="space-y-0" aria-busy="true" aria-label="Loading timeline page">
        <h1 className="sr-only">Timeline</h1>
        <section aria-label="Timeline loading placeholder" className="space-y-0">
          <CollectionToolbarSkeleton search={false} count={false} viewSegments={2} />
          <TimelineFeedSkeleton count={8} />
        </section>
      </div>
    </>
  );
}
