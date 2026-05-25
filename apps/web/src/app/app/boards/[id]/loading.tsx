import { PageHeaderSkeleton } from '@/components/loading-states';

/**
 * Board detail can render as kanban, table, or list — three structurally
 * different layouts, and we don't know which until `board.kind` loads.
 * Any committed body shape would mismatch two of the three. Render the
 * index strip only and leave the body to the real page; the layout shift
 * is bounded to the body, the index strip position stays stable.
 */
export default function BoardDetailLoading() {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton />
    </div>
  );
}
