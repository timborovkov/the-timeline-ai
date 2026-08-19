import { CollectionRowsSkeleton, PageHeaderSkeleton } from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function BoardsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading boards
      </output>
      <h1 className="sr-only">Boards</h1>
      <div className="space-y-6" aria-busy="true" aria-label="Loading boards">
        <div aria-hidden="true">
          <PageHeaderSkeleton variant="collection" action />
        </div>
        <WorkSubnav current="/app/boards" />
        <section aria-hidden="true" aria-label="Boards list loading placeholder">
          <CollectionRowsSkeleton count={3} />
        </section>
      </div>
    </>
  );
}
