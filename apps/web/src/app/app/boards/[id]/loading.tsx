import { Skeleton } from '@/components/ui/skeleton';

/**
 * Board detail can render as kanban, table, or list — three structurally
 * different layouts, and we don't know which until `board.kind` loads.
 * Any committed body shape would mismatch two of the three. Render the
 * header only and leave the body area to the real page; the layout shift
 * is bounded to the body, the header position stays stable.
 */
export default function BoardDetailLoading() {
  return (
    <div>
      <header className="mb-8 flex items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-9 rounded-md" />
      </header>
    </div>
  );
}
