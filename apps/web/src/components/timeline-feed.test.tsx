// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebTimelineMomentDto } from '@/lib/timeline-moments';
import type { TimelineEvent, TimelinePage } from '@/lib/use-paginated-queries';

const fakes = vi.hoisted(() => ({
  pages: [] as TimelinePage[],
  queryOverrides: {},
  useTimelineInfiniteQuery: vi.fn(),
  timelineList: vi.fn(),
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
        isError: false,
        error: null,
        isFetchingNextPage: false,
        isRefetching: false,
        refetch: vi.fn(),
        ...fakes.queryOverrides,
      };
    },
  };
});

vi.mock('@/components/timeline-list', () => ({
  TimelineList: (props: {
    events: TimelineEvent[];
    mode?: 'moments' | 'events';
    serverMoments?: { id: string; title: string }[];
  }) => {
    fakes.timelineList(props);
    return createElement(
      'ol',
      null,
      (props.serverMoments ?? props.events).map((item) =>
        createElement('li', { key: item.id }, 'title' in item ? item.title : item.id),
      ),
    );
  },
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

function page(items: TimelineEvent[], overrides: Partial<TimelinePage> = {}): TimelinePage {
  return {
    items,
    nextCursor: null,
    authors: {},
    audioUrls: {},
    impactItems: {},
    artifactClusters: {},
    capturedFiles: {},
    ...overrides,
  };
}

describe('TimelineFeed', () => {
  beforeEach(() => {
    fakes.pages = [];
    fakes.queryOverrides = {};
    fakes.useTimelineInfiniteQuery.mockClear();
    fakes.timelineList.mockClear();
  });

  afterEach(() => {
    cleanup();
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
      { from: '2026-06-22', mode: 'moments' },
      initialPage,
      expect.objectContaining({ timezone: 'Europe/Tallinn' }),
    );
  });

  it('passes focused moment ids into the infinite-query cache identity', () => {
    const initialPage = page([]);

    renderToStaticMarkup(
      createElement(TimelineFeed, {
        initialPage,
        filters: { moment: 'moment:telegram:chat-a:2026-06-27:18:00' },
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
        focusMomentId: 'moment:telegram:chat-a:2026-06-27:18:00',
      }),
    );

    expect(fakes.useTimelineInfiniteQuery).toHaveBeenCalledWith(
      { moment: 'moment:telegram:chat-a:2026-06-27:18:00', mode: 'moments' },
      initialPage,
      expect.any(Object),
    );
    expect(fakes.timelineList).toHaveBeenCalledWith(
      expect.objectContaining({ focusMomentId: 'moment:telegram:chat-a:2026-06-27:18:00' }),
    );
  });

  it('hydrates and passes server-built moments to the timeline list', () => {
    const event = timelineEvent('raw-1', '2026-06-03T12:00:00.000Z');
    const serverMoment: WebTimelineMomentDto = {
      id: 'moment:server:raw-1',
      version: 'timeline_moment.v1',
      anchorId: 'tm-server',
      kind: 'integration_activity',
      dateKey: '2026-06-03',
      dateLabel: 'Today',
      timeLabel: '12:00',
      source: 'integration',
      sourceLabel: 'Integration',
      sourceIcon: 'integration',
      actorLabel: 'GitHub',
      contextLabel: 'CI',
      title: 'Server bundled CI activity',
      subtitle: null,
      preview: 'A server-made bundle.',
      confidence: 'deterministic',
      grouping: {
        strategy: 'provider_bundle',
        key: 'ci',
        sourceFamilies: ['integration'],
      },
      evidenceSummary: {
        rawEventCount: 1,
        sourceLabels: ['Integration'],
        actorLabels: ['GitHub'],
        contextLabels: ['CI'],
        timeRange: '12:00',
      },
      summary: 'Server bundled CI activity',
      rawEventIds: [event.id],
      impactItems: [],
      artifactClusters: [],
    };
    const initialPage = page([event], {
      version: 'timeline_moments_page.v1',
      groupingVersion: 'timeline_grouping.v1',
      mode: 'moments',
      moments: [serverMoment],
      rawEventsById: { [event.id]: event },
    });
    fakes.pages = [initialPage];

    const html = renderToStaticMarkup(
      createElement(TimelineFeed, {
        initialPage,
        filters: {},
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
      }),
    );

    expect(html).toContain('Server bundled CI activity');
    expect(fakes.timelineList).toHaveBeenCalledWith(
      expect.objectContaining({
        serverMoments: [
          expect.objectContaining({
            title: 'Server bundled CI activity',
            rawEvents: [event],
          }),
        ],
      }),
    );
  });

  it('passes source-event mode to fetching and the timeline list', () => {
    const initialPage = page([timelineEvent('event-1')]);
    fakes.pages = [initialPage];

    renderToStaticMarkup(
      createElement(TimelineFeed, {
        initialPage,
        filters: { source: 'integration' },
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
        mode: 'events',
      }),
    );

    expect(fakes.useTimelineInfiniteQuery).toHaveBeenCalledWith(
      { source: 'integration', mode: 'events' },
      initialPage,
      expect.any(Object),
    );
    expect(fakes.timelineList).toHaveBeenCalledWith(expect.objectContaining({ mode: 'events' }));
  });

  it('keeps loaded moments visible and offers retry when timeline refresh fails', () => {
    const initialPage = page([timelineEvent('event-1')]);
    const refetch = vi.fn();
    fakes.pages = [initialPage];
    fakes.queryOverrides = {
      isError: true,
      error: new Error('upstream timeout'),
      refetch,
    };

    render(
      createElement(TimelineFeed, {
        initialPage,
        filters: { source: 'integration' },
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
      }),
    );

    expect(screen.getByText('event-1')).toBeTruthy();
    expect(
      screen.getByText(
        'Timeline updates could not load. The current moments and filters are still available.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry timeline' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('announces that pagination is complete without leaving a disabled action', () => {
    const initialPage = page([timelineEvent('event-1')]);
    fakes.pages = [initialPage];

    render(
      createElement(TimelineFeed, {
        initialPage,
        filters: {},
        currentUserId: 'user-1',
        isAdmin: false,
        members: [],
      }),
    );

    const completionStatus = screen.getByRole('status');
    expect(completionStatus.textContent).toBe("You've reached the end of the timeline.");
    expect(completionStatus.getAttribute('tabindex')).toBe('-1');
    expect(screen.queryByRole('button', { name: 'End of timeline' })).toBeNull();
  });
});
