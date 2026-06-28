'use client';

import { useMemo } from 'react';

import type {
  ImpactKind,
  ImpactItem,
  TimelineMoment,
  WebTimelineMomentDto,
} from '@/lib/timeline-moments';

import { InlineError } from '@/components/inline-error';
import { TimelineList } from '@/components/timeline-list';
import {
  useTimelineInfiniteQuery,
  type TimelineEvent,
  type TimelinePage,
} from '@/lib/use-paginated-queries';

interface Props {
  initialPage: TimelinePage;
  filters: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    impact?: string | null;
    event?: string | null;
    moment?: string | null;
    mode?: 'moments' | 'events';
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
  focusMomentId?: string | null;
  live?: boolean;
  timezone?: string;
  mode?: 'moments' | 'events';
}

function hydrateServerMoment(
  moment: WebTimelineMomentDto,
  rawEventsById: Map<string, TimelineEvent>,
): TimelineMoment | null {
  const rawEvents = moment.rawEventIds.map((eventId) => rawEventsById.get(eventId));
  if (rawEvents.some((event) => event === undefined)) return null;
  return { ...moment, rawEvents: rawEvents as TimelineEvent[] };
}

function hydrateServerMoments(
  pages: TimelinePage[],
  mode: 'moments' | 'events',
): TimelineMoment[] | undefined {
  if (mode !== 'moments') return undefined;

  const rawEventsById = new Map<string, TimelineEvent>();
  for (const page of pages) {
    for (const event of page.items) rawEventsById.set(event.id, event);
    for (const [eventId, event] of Object.entries(page.rawEventsById ?? {})) {
      rawEventsById.set(eventId, event);
    }
  }

  const hydratedMoments: TimelineMoment[] = [];
  const seen = new Set<string>();
  let sawServerMoments = false;

  for (const page of pages) {
    if (!Array.isArray(page.moments)) {
      if (page.items.length > 0) return undefined;
      continue;
    }

    sawServerMoments = true;
    for (const moment of page.moments) {
      if (seen.has(moment.id)) continue;
      const hydrated = hydrateServerMoment(moment, rawEventsById);
      if (hydrated === null) return undefined;
      hydratedMoments.push(hydrated);
      seen.add(moment.id);
    }
  }

  return sawServerMoments ? hydratedMoments : undefined;
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
  focusMomentId = null,
  live = true,
  timezone,
  mode = 'moments',
}: Props) {
  const query = useTimelineInfiniteQuery({ ...filters, mode }, initialPage, {
    enabled: live,
    timezone,
  });
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
  const artifactClustersByEventId = useMemo(
    () => Object.fromEntries(pages.flatMap((page) => Object.entries(page.artifactClusters))),
    [pages],
  );
  const capturedFilesByEventId = useMemo(
    () =>
      Object.fromEntries(
        pages.flatMap((page) => Object.entries(page.capturedFiles)),
      ) as TimelinePage['capturedFiles'],
    [pages],
  );
  const serverMoments = useMemo(() => hydrateServerMoments(pages, mode), [pages, mode]);
  const queryErrorDetails = query.error instanceof Error ? query.error.message : undefined;

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
        serverMoments={serverMoments}
        emptyLabel={emptyLabel}
        emptyAction={emptyAction}
        impactFilter={impactFilter}
        impactItemsByEventId={impactItemsByEventId}
        artifactClustersByEventId={artifactClustersByEventId}
        capturedFilesByEventId={capturedFilesByEventId}
        focusEventId={focusEventId}
        focusMomentId={focusMomentId}
        timezone={timezone}
        mode={mode}
      />
      {query.isError ? (
        <InlineError
          message="Timeline updates could not load. The current moments and filters are still available."
          details={queryErrorDetails}
          onRetry={() => {
            void query.refetch();
          }}
          retryLabel="Retry timeline"
          retrying={query.isRefetching}
        />
      ) : null}
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
