import { PageHeaderSkeleton } from '@/components/loading-states';
import { ObjectDetailSkeleton } from '@/components/objects/object-detail-skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function EntityLoading() {
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
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects" />
        <ObjectDetailSkeleton />
      </div>
    </>
  );
}
