'use client';

import { useMemo } from 'react';

import { TimelineList } from '@/components/timeline-list';
import { useTimelineInfiniteQuery, type TimelineEvent } from '@/lib/use-paginated-queries';

interface Props {
  initialPage: {
    items: TimelineEvent[];
    nextCursor: string | null;
    authors: Record<string, { id: string; name: string | null; email: string }>;
    audioUrls: Record<string, string>;
  };
  filters: { author?: string | null; from?: string | null; to?: string | null };
  currentUserId: string;
  isAdmin: boolean;
}

export function TimelineFeed({ initialPage, filters, currentUserId, isAdmin }: Props) {
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

  return (
    <div className="space-y-3">
      <TimelineList
        events={events}
        authorMap={authorMap}
        audioUrlMap={audioUrlMap}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
      <div className="flex justify-center">
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
