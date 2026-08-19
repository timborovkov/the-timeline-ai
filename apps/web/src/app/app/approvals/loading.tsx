import {
  CollectionRowsSkeleton,
  CollectionToolbarSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function ApprovalsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading approvals
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading approvals">
        <h1 className="sr-only">Approvals</h1>
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/approvals" />
        <div aria-hidden="true" className="motion-reduce:[&_.animate-pulse]:animate-none">
          <section aria-label="Approvals loading placeholder">
            <CollectionToolbarSkeleton search={false} viewSegments={4} />
            <CollectionRowsSkeleton count={6} />
          </section>
        </div>
      </div>
    </>
  );
}
