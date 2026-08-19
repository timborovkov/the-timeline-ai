'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { InlineError } from '@/components/inline-error';
import { getAppMainScrollElement } from '@/lib/app-scroll';
import { cn } from '@/lib/utils';

interface InfiniteScrollProps {
  hasMore: boolean;
  loading?: boolean;
  error?: string | null;
  errorDetails?: string;
  onLoadMore: () => void;
  onRetry?: () => void;
  boundLabel: string;
  root?: Element | null;
  disabled?: boolean;
  hideBound?: boolean;
  className?: string;
  loadingContent?: ReactNode;
}

/**
 * Quiet infinite-scroll footer. Prefetches when the sentinel nears the
 * scrollport, loads on keyboard focus, and keeps Retry as the only button.
 */
export function InfiniteScroll({
  hasMore,
  loading = false,
  error = null,
  errorDetails,
  onLoadMore,
  onRetry,
  boundLabel,
  root,
  disabled = false,
  hideBound = false,
  className,
  loadingContent,
}: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLButtonElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const loadingRef = useRef(loading);
  onLoadMoreRef.current = onLoadMore;
  loadingRef.current = loading;

  function requestMore(): void {
    if (disabled || loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    onLoadMoreRef.current();
  }

  // Re-attach after loading finishes so a sentinel that is still in view can
  // fetch the next page. onLoadMore stays in a ref.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || disabled || loading) return;
    // A passed-in root of null means the overflow parent is not mounted yet.
    // Do not fall back to #main — that auto-fetches every page from a nested list.
    if (root === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestMore();
      },
      {
        root: root ?? getAppMainScrollElement(),
        rootMargin: '400px 0px',
        threshold: 0,
      },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [disabled, hasMore, loading, root]);

  if (error) {
    return (
      <div className={cn('py-3', className)}>
        <InlineError
          message={error}
          details={errorDetails}
          onRetry={onRetry ?? onLoadMore}
          retrying={loading}
        />
      </div>
    );
  }

  if (!hasMore && !loading) {
    if (hideBound) return null;
    return (
      <p role="status" className={cn('m-0 px-3 py-2 text-center text-xs text-fg-dim', className)}>
        {boundLabel}
      </p>
    );
  }

  const customLoading = loading && loadingContent !== undefined;

  return (
    <div
      className={cn(customLoading ? 'w-full' : 'flex justify-center py-2', className)}
      aria-busy={loading || undefined}
    >
      {loading ? (
        customLoading ? (
          <output aria-label="Loading more" className="block w-full">
            {loadingContent}
          </output>
        ) : (
          <p role="status" className="m-0 px-3 py-2 text-xs text-fg-dim">
            Loading more…
          </p>
        )
      ) : (
        <button
          ref={sentinelRef}
          type="button"
          onFocus={requestMore}
          onClick={requestMore}
          className="h-px w-full max-w-xs cursor-default border-0 bg-transparent p-0 text-[0] text-transparent outline-none focus-visible:h-auto focus-visible:rounded-sm focus-visible:border focus-visible:border-border focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-xs focus-visible:text-fg-muted"
        >
          Load more
        </button>
      )}
    </div>
  );
}
