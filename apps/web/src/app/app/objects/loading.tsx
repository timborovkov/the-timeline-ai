import {
  CollectionGroupSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function ObjectsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading objects
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading objects"
      >
        <h1 className="sr-only">Objects</h1>
        <div aria-hidden="true" inert>
          <PageHeaderSkeleton />
        </div>
        <WorkSubnav current="/app/objects" />
        <div aria-hidden="true" inert className="space-y-0">
          <CollectionToolbarSkeleton action />
          <CollectionGroupSkeleton groups={2} rows={4} />
        </div>
      </div>
    </>
  );
}
