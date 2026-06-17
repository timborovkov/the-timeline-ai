import { Skeleton } from '@/components/ui/skeleton';

/**
 * Index-strip skeleton — the mono one-liner that opens every operational
 * surface. Match the heights and widths of the real `<IndexStrip>` so CLS
 * stays zero.
 */
export function PageHeaderSkeleton() {
  return (
    <div
      className="flex items-baseline gap-x-4 border-y border-border py-3"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-12" />
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
    <ol className="border-t border-border" aria-busy="true" aria-label="Loading timeline">
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
    <div
      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
      aria-live="polite"
    >
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-sm bg-signal" />
      {label}
    </div>
  );
}
