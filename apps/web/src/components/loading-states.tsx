import { Skeleton } from '@/components/ui/skeleton';

/**
 * Quiet page-header skeleton matching title, subtitle, and optional metadata.
 */
export function PageHeaderSkeleton({
  variant = 'default',
}: {
  variant?: 'default' | 'collection';
}) {
  if (variant === 'collection') {
    return (
      <div
        className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2"
        aria-busy="true"
        aria-label="Loading"
      >
        <Skeleton className="h-7 w-36" />
        <div className="flex gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="flex gap-3 pt-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

export function CollectionRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="border-t border-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-3"
        >
          <Skeleton className="size-4 rounded-sm" />
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-4 w-2/5 max-w-xs" />
            <Skeleton className="hidden h-3 w-24 sm:block" />
          </div>
          <Skeleton className="h-7 w-16 rounded-sm" />
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
    <ol className="border-t border-border" aria-busy="true" aria-label="Loading timeline">
      {Array.from({ length: count }).map((_, i) => (
        <TimelineRowSkeleton key={i} />
      ))}
    </ol>
  );
}

export function HairlineSectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 border-y border-border py-4" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={index === 0 ? 'h-3 w-full max-w-md' : 'h-3 w-2/3 max-w-sm'}
        />
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
