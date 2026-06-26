import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TimelineEvent, TimelinePage } from '@/lib/use-paginated-queries';

const fakes = vi.hoisted(() => ({
  pages: [] as TimelinePage[],
  useTimelineInfiniteQuery: vi.fn(),
}));

vi.mock('@/lib/use-paginated-queries', () => {
  return {
    useTimelineInfiniteQuery: (
      filters: Record<string, string | null | undefined>,
      initialPage: TimelinePage,
      options: { enabled?: boolean; timezone?: string },
    ) => {
      fakes.useTimelineInfiniteQuery(filters, initialPage, options);
      return {
        data: { pages: fakes.pages },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      };
    },
  };
});

vi.mock('@/components/timeline-list', () => ({
  TimelineList: ({ events }: { events: TimelineEvent[] }) =>
    createElement(
      'ol',
      null,
      events.map((event) => createElement('li', { key: event.id }, event.id)),
    ),
}));

const { TimelineFeed } = await import('./timeline-feed.js');

function timelineEvent(id: string, occurredAt = '2026-06-03T13:04:00.000Z'): TimelineEvent {
  return {
    id,
    teamId: 'team-1',
    authorUserId: null,
    source: 'meeting',
    contentText: id,
    contentAudioUrl: null,
    occurredAt,
    createdAt: occurredAt,
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    sourceMetadata: {},
  };
}

function page(items: TimelineEvent[]): TimelinePage {
  return {
    items,
    nextCursor: null,
    authors: {},
    audioUrls: {},
    impactItems: {},
    artifactClusters: {},
    capturedFiles: {},
  };
}

describe('TimelineFeed', () => {
  beforeEach(() => {
    fakes.pages = [];
    fakes.useTimelineInfiniteQuery.mockClear();
  });

  it('deduplicates focused events that reappear on later pages', () => {
    const focused = timelineEvent('focused', '2026-06-01T12:00:00.000Z');
    fakes.pages = [
      page([timelineEvent('newer', '2026-06-03T12:00:00.000Z'), focused]),
      page([focused, timelineEvent('older', '2026-05-30T12:00:00.000Z')]),
    ];

    const html = renderToStaticMarkup(
      createElement(TimelineFeed, {
        initialPage: page([]),
        filters: {},
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
      }),
    );

    expect(html.match(/<li>focused<\/li>/g)).toHaveLength(1);
    expect(html).toContain('<li>newer</li>');
    expect(html).toContain('<li>older</li>');
  });

  it('passes timezone into the infinite-query cache identity', () => {
    const initialPage = page([]);

    renderToStaticMarkup(
      createElement(TimelineFeed, {
        initialPage,
        filters: { from: '2026-06-22' },
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
        timezone: 'Europe/Tallinn',
      }),
    );

    expect(fakes.useTimelineInfiniteQuery).toHaveBeenCalledWith(
      { from: '2026-06-22' },
      initialPage,
      expect.objectContaining({ timezone: 'Europe/Tallinn' }),
    );
  });
});
