'use client';

import { useMemo } from 'react';

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
  };
  filters: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    impact?: string | null;
  };
  currentUserId: string;
  isAdmin: boolean;
  members: { id: string; label: string }[];
  compact?: boolean;
  maxMoments?: number;
  emptyLabel?: string;
  density?: 'comfortable' | 'dense';
  impactFilter?: ImpactKind | 'all';
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
  density = 'comfortable',
  impactFilter = 'all',
}: Props) {
  const query = useTimelineInfiniteQuery(filters, initialPage);
  const pages = query.data.pages;
  const events = pages.flatMap((page) => page.items);
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
        density={density}
        impactFilter={impactFilter}
        impactItemsByEventId={impactItemsByEventId}
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
