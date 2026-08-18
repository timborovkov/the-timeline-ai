import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function DigestsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading digests
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading digests">
        <h1 className="sr-only">Digests</h1>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/digests" />
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <CollectionRowsSkeleton count={6} />
        </div>
      </div>
    </>
  );
}
