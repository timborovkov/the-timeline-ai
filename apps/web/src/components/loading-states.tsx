import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Quiet page-header skeleton matching title, subtitle, and optional metadata.
 */
export function PageHeaderSkeleton({
  action = false,
  showMetadata = true,
}: {
  action?: boolean;
  showMetadata?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-1"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
        {showMetadata ? (
          <div className="flex gap-3 pt-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ) : null}
      </div>
      {action ? <Skeleton className="h-9 w-24 shrink-0" /> : null}
    </div>
  );
}

/**
 * Matches {@link CollectionToolbar}: optional search, optional count, Filters,
 * optional view toggle, and optional compact add action on one `min-h-11` row.
 */
export function CollectionToolbarSkeleton({
  viewSegments = 0,
  action = false,
  search = true,
  count = true,
}: {
  viewSegments?: number;
  action?: boolean;
  search?: boolean;
  count?: boolean;
}) {
  return (
    <div className="border-b border-border bg-bg" data-loading-toolbar="collection">
      <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 px-2 sm:px-3">
        {search ? (
          <div className="min-w-48 flex-1 sm:max-w-sm">
            <Skeleton className="h-9 w-full max-w-56" />
          </div>
        ) : null}
        {count ? <Skeleton className="h-3 w-14" /> : null}
        <Skeleton className="h-9 w-16" />
        {viewSegments > 0 ? (
          <div className="ml-auto flex min-h-10 items-center">
            <div className="inline-flex overflow-hidden rounded-sm bg-surface">
              {Array.from({ length: viewSegments }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-14 rounded-none" />
              ))}
            </div>
          </div>
        ) : null}
        {action ? (
          <div className={cn('flex min-h-10 items-center', viewSegments === 0 && 'ml-auto')}>
            <Skeleton className="h-9 w-20" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CollectionRowSkeleton({
  leading = false,
  subtitle = false,
  metadata = 3,
}: {
  leading?: boolean;
  subtitle?: boolean;
  metadata?: number;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border/80 px-2 last:border-b-0 sm:px-3">
      {leading ? <Skeleton className="size-4 shrink-0" /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-4 w-2/5" />
        {subtitle ? <Skeleton className="h-3 w-1/3" /> : null}
      </div>
      <div className="ml-auto hidden items-center gap-2 sm:flex">
        {Array.from({ length: metadata }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-14" />
        ))}
      </div>
    </div>
  );
}

export function CollectionGroupSkeleton({
  groups = 2,
  rows = 4,
  leading = true,
  subtitle = false,
}: {
  groups?: number;
  rows?: number;
  leading?: boolean;
  subtitle?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {Array.from({ length: groups }).map((_, group) => (
        <section key={group}>
          <div className="flex min-h-10 items-center gap-2 border-y border-border bg-surface/70 px-2 sm:px-3">
            <Skeleton className="h-3.5 w-3.5" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-6" />
          </div>
          {Array.from({ length: rows }).map((_, index) => (
            <CollectionRowSkeleton key={index} leading={leading} subtitle={subtitle} />
          ))}
        </section>
      ))}
    </div>
  );
}

const KANBAN_LANE_WIDTH = {
  board: 'w-[min(290px,calc(100vw-4rem))]',
  task: 'w-[min(260px,calc(100vw-2.5rem))]',
} as const;

export function CompactKanbanSkeleton({
  columns = 3,
  variant = 'board',
}: {
  columns?: number;
  variant?: keyof typeof KANBAN_LANE_WIDTH;
}) {
  return (
    <section className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-2 pb-4 sm:px-3">
      {Array.from({ length: columns }).map((_, column) => (
        <div
          key={column}
          className={cn(
            'flex shrink-0 flex-col rounded-sm border border-border bg-surface p-2',
            KANBAN_LANE_WIDTH[variant],
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-6" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-sm border border-border bg-bg px-2 py-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-1 h-3 w-1/2" />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Skeleton className="h-3 w-10" />
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function CollectionTableSkeleton({
  rows = 6,
  columns = 5,
  subtitle = true,
}: {
  rows?: number;
  columns?: number;
  subtitle?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-10 items-center gap-3 border-b border-border px-2 sm:px-3">
        <Skeleton className="size-4 shrink-0" />
        <Skeleton className="h-3 w-16" />
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="ml-auto h-3 w-14 first:ml-0" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-11 items-center gap-3 border-b border-border/80 px-2 sm:px-3"
        >
          <Skeleton className="size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-4 w-2/5" />
            {subtitle ? <Skeleton className="h-3 w-1/3" /> : null}
          </div>
          {Array.from({ length: columns }).map((_, column) => (
            <Skeleton key={column} className="hidden h-4 w-14 sm:block" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Flat-row skeleton matching the new `<TimelineList>` shape:
 *   [mono ts] [source/title/body] [impact/status]
 *
 * Internal — consumed by {@link TimelineFeedSkeleton}. Exported routes
 * that need a single row should use the feed skeleton with `count={1}`.
 */
function TimelineRowSkeleton() {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border py-3 md:grid-cols-[6.75rem_minmax(0,1fr)_12rem]">
      <Skeleton className="h-3 w-14" />
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-3 w-8/12" />
      </div>
      <div className="hidden justify-end gap-1.5 md:flex">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
    </li>
  );
}

export function TimelineFeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ol aria-busy="true" aria-label="Loading timeline">
      {Array.from({ length: count }).map((_, i) => (
        <TimelineRowSkeleton key={i} />
      ))}
    </ol>
  );
}

/**
 * Generic card skeleton — kept for non-timeline surfaces (objects, boards)
 * that haven't migrated to flat rows. Tighter chrome than v1.
 */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-sm border border-border bg-surface p-4 ${className ?? ''}`}
      aria-busy="true"
    >
      <div className="flex items-start gap-3">
        <Skeleton className="size-7 shrink-0 rounded-sm" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function EntityGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      aria-busy="true"
      aria-label="Loading entities"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-sm border border-border bg-surface px-3 py-2"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function InlineSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-fg-dim" aria-live="polite">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-sm bg-signal" />
      {label}
    </div>
  );
}
