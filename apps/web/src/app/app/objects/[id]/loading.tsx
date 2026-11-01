import { HistoryBackLinkSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { ObjectDetailSkeleton } from '@/components/objects/object-detail-skeleton';

export default function ObjectDetailLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading object
      </output>
      <div
        className="space-y-2 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading object"
      >
        <h1 className="sr-only">Object</h1>
        <div aria-hidden="true" inert className="space-y-2">
          <HistoryBackLinkSkeleton />
          <PageHeaderSkeleton action />
          <ObjectDetailSkeleton />
        </div>
      </div>
    </>
  );
}
