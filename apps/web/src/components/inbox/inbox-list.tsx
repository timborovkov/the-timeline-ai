'use client';

import { useState, useTransition } from 'react';

import { loadNotificationsPageAction } from '@/app/actions/collection-pages';
import { InfiniteScroll } from '@/components/collections/infinite-scroll';
import { VirtualList } from '@/components/collections/virtual-list';
import { NotificationRow } from '@/components/inbox/notification-row';
import { formatCollectionCount } from '@/lib/collection-count';

interface InboxNotification {
  id: string;
  kind: string;
  summary: string;
  entityId: string | null;
  agentSuggestionId: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

interface InboxListProps {
  initialRows: InboxNotification[];
  nextOffset: number | null;
  unreadOnly: boolean;
  matchingCount: number;
  totalCount: number;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Unread vs all remounts extra pages without copying the first page into state.
export function InboxList(props: InboxListProps) {
  return <InboxListPages key={props.unreadOnly ? 'unread' : 'all'} {...props} />;
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Unread vs all remounts extra pages without copying the first page into state.
function InboxListPages({
  initialRows,
  nextOffset,
  unreadOnly,
  matchingCount,
  totalCount,
}: InboxListProps) {
  const [extraRows, setExtraRows] = useState<InboxNotification[]>([]);
  const [extraOffset, setExtraOffset] = useState<number | null>(null);
  const [paged, setPaged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const rows = [...initialRows, ...extraRows];
  const offset = paged ? extraOffset : nextOffset;

  function loadMore(): void {
    if (offset === null || loading) return;
    startLoading(async () => {
      const page = await loadNotificationsPageAction({ offset, unreadOnly });
      if (page.error) {
        setError(page.error);
        return;
      }
      setError(null);
      setPaged(true);
      setExtraRows((current) => {
        const seen = new Set([...initialRows, ...current].map((row) => row.id));
        return [...current, ...page.rows.filter((row) => !seen.has(row.id))];
      });
      setExtraOffset(page.nextOffset);
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
            payload={n.payload}
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
