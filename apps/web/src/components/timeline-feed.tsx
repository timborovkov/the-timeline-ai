'use client';

import { useMemo } from 'react';

import type { TimelineCapturedFile } from '@/lib/timeline-captured-files';
import type { ImpactKind, ImpactItem } from '@/lib/timeline-moments';

import { TimelineList } from '@/components/timeline-list';
import { useTimelineInfiniteQuery, type TimelineEvent } from '@/lib/use-paginated-queries';

interface Props {
  initialPage: {
    items: TimelineEvent[];
    nextCursor: string | null;
    authors: Record<string, { id: string; name: string | null; email: string }>;
    audioUrls: Record<string, string>;
    impactItems: Record<string, ImpactItem[]>;
    capturedFiles: Record<string, TimelineCapturedFile[]>;
  };
  filters: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    impact?: string | null;
    event?: string | null;
  };
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  compact?: boolean;
  maxMoments?: number;
  emptyLabel?: string;
  emptyAction?: { href: string; label: string; body: string };
  impactFilter?: ImpactKind | 'all';
  focusEventId?: string | null;
  live?: boolean;
}

export function TimelineFeed({
  initialPage,
  filters,
  currentUserId,
  isAdmin,
  members,
  compact = false,
  maxMoments,
  emptyLabel,
  emptyAction,
  impactFilter = 'all',
  focusEventId = null,
  live = true,
}: Props) {
  const query = useTimelineInfiniteQuery(filters, initialPage, { enabled: live });
  const pages = query.data.pages;
  const events = useMemo(() => {
    const seen = new Set<string>();
    return pages.flatMap((page) =>
      page.items.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      }),
    );
  }, [pages]);
  const authorMap = useMemo(
    () =>
      new Map(
        pages.flatMap((page) =>
          Object.entries(page.authors).map(([id, author]) => [id, author] as const),
        ),
      ),
    [pages],
  );
  const audioUrlMap = useMemo(
    () =>
      new Map(
        pages.flatMap((page) => Object.entries(page.audioUrls).map(([id, url]) => [id, url])),
      ),
    [pages],
  );
  const impactItemsByEventId = useMemo(
    () =>
      Object.fromEntries(pages.flatMap((page) => Object.entries(page.impactItems))) as Record<
        string,
        ImpactItem[]
      >,
    [pages],
  );
  const capturedFilesByEventId = useMemo(
    () =>
      Object.fromEntries(pages.flatMap((page) => Object.entries(page.capturedFiles))) as Record<
        string,
        TimelineCapturedFile[]
      >,
    [pages],
  );

  return (
    <div className="space-y-3">
      <TimelineList
        events={events}
        authorMap={authorMap}
        audioUrlMap={audioUrlMap}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        members={members}
        compact={compact}
        maxMoments={maxMoments}
        emptyLabel={emptyLabel}
        emptyAction={emptyAction}
        impactFilter={impactFilter}
        impactItemsByEventId={impactItemsByEventId}
        capturedFilesByEventId={capturedFilesByEventId}
        focusEventId={focusEventId}
      />
      <div className={compact ? 'hidden' : 'flex justify-center'}>
        <button
          type="button"
          disabled={!query.hasNextPage || query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
          className="rounded-sm border border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted transition-colors hover:bg-surface disabled:opacity-40"
        >
          {query.isFetchingNextPage
            ? 'Loading...'
            : query.hasNextPage
              ? 'Load more'
              : 'End of timeline'}
        </button>
      </div>
    </div>
  );
}
