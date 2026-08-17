'use client';

import { useMemo, useState, useTransition } from 'react';

import { loadNotificationsPageAction } from '@/app/actions/collection-pages';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { NotificationRow } from '@/components/inbox/notification-row';
import { formatCollectionCount } from '@/lib/collection-count';

export interface InboxNotification {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  agentSuggestionId: string | null;
  createdAt: string;
  readAt: string | null;
}

export function InboxList({
  initialRows,
  nextOffset,
  unreadOnly,
  matchingCount,
  totalCount,
}: {
  initialRows: InboxNotification[];
  nextOffset: number | null;
  unreadOnly: boolean;
  matchingCount: number;
  totalCount: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [offset, setOffset] = useState(nextOffset);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const seen = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);

  function loadMore(): void {
    if (offset === null || loading) return;
    startLoading(async () => {
      const page = await loadNotificationsPageAction({ offset, unreadOnly });
      if (page.error) {
        setError(page.error);
        return;
      }
      setError(null);
      setRows((current) => [
        ...current,
        ...page.rows.filter(
          (row) => !seen.has(row.id) && !current.some((item) => item.id === row.id),
        ),
      ]);
      setOffset(page.nextOffset);
    });
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs tabular-nums text-fg-dim">
        {formatCollectionCount({
          matching: matchingCount,
          total: totalCount,
          filtered: unreadOnly,
        })}
      </p>
      <VirtualList
        items={rows}
        getItemKey={(row) => row.id}
        estimateSize={64}
        renderItem={(n) => (
          <NotificationRow
            id={n.id}
            kind={n.kind}
            summary={n.summary}
            entityId={n.entityId}
            agentSuggestionId={n.agentSuggestionId}
            createdAt={n.createdAt}
            initiallyRead={n.readAt !== null}
          />
        )}
      />
      <InfiniteScroll
        hasMore={offset !== null}
        loading={loading}
        error={error}
        onLoadMore={loadMore}
        boundLabel="No more matching notifications"
      />
    </div>
  );
}
