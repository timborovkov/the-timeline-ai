import { DigestTableSkeleton, PageHeaderSkeleton } from '@/components/loading-states';

export default function DigestsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading update history
      </output>
      <div
        data-app-width="collection"
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading update history"
      >
        <h1 className="sr-only">Update history</h1>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <DigestTableSkeleton />
        </div>
      </div>
    </>
  );
}
