import {
  buildTimelineMomentPresentationCacheFingerprint,
  buildTimelineMomentPresentationCacheKey,
} from '@timeline/shared/timeline-moments/presentation';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { buildTimelineMoments, type TimelineMoment } from '@/lib/timeline-moments';
import { applyCachedTimelineMomentPresentations, collectTimelinePage } from '@/lib/timeline-page';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function event(
  id: string,
  occurredAt: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    teamId: TEAM_ID,
    authorUserId: USER_ID,
    source: 'web',
    contentText: id,
    contentAudioUrl: null,
    occurredAt,
    createdAt: occurredAt,
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: USER_ID,
    sourceMetadata: {},
    ...overrides,
  };
}

describe('collectTimelinePage', () => {
  it('scans past unmatching pages for impact-filtered timelines', async () => {
    const pages = new Map([
      [
        null,
        {
          items: [event('unmatched', '2026-05-28T12:00:00.000Z')],
          nextCursor: 'page-2',
        },
      ],
      [
        'page-2',
        {
          items: [event('task-event', '2026-05-28T11:00:00.000Z')],
          nextCursor: 'page-3',
        },
      ],
    ]);

    const page = await collectTimelinePage({
      impact: 'task',
      limit: 1,
      fetchPage: ({ cursor }) =>
        Promise.resolve(pages.get(cursor) ?? { items: [], nextCursor: null }),
      hydrateImpact: (ids) =>
        Promise.resolve(
          Object.fromEntries(
            ids.map((id) => [
              id,
              id === 'task-event' ? [{ kind: 'task' as const, label: 'Follow up' }] : [],
            ]),
          ),
        ),
    });

    expect(page.items.map((item) => item.id)).toEqual(['task-event']);
    expect(page.nextCursor).toBe('page-3');
  });

  it('keeps the scanned cursor when an impact scan reaches its cap without matches', async () => {
    const page = await collectTimelinePage({
      impact: 'document',
      maxScanPages: 2,
      pageSize: 1,
      fetchPage: ({ cursor }) =>
        Promise.resolve(
          cursor === null
            ? { items: [event('a', '2026-05-28T12:00:00.000Z')], nextCursor: 'b' }
            : { items: [event('b', '2026-05-28T11:00:00.000Z')], nextCursor: 'c' },
        ),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe('c');
  });

  it('matches any selected impact while scanning timeline pages', async () => {
    const page = await collectTimelinePage({
      impact: ['task', 'document'],
      limit: 2,
      fetchPage: () =>
        Promise.resolve({
          items: [
            event('task-event', '2026-05-28T12:00:00.000Z'),
            event('document-event', '2026-05-28T11:00:00.000Z'),
            event('object-event', '2026-05-28T10:00:00.000Z'),
          ],
          nextCursor: null,
        }),
      hydrateImpact: (ids) =>
        Promise.resolve(
          Object.fromEntries(
            ids.map((id) => [
              id,
              id === 'task-event'
                ? [{ kind: 'task' as const, label: 'Follow up' }]
                : id === 'document-event'
                  ? [{ kind: 'document' as const, label: 'Brief' }]
                  : [{ kind: 'object' as const, label: 'Account' }],
            ]),
          ),
        ),
    });

    expect(page.items.map((item) => item.id)).toEqual(['task-event', 'document-event']);
  });

  it('keeps grouped moment siblings from scanned pages when one event matches impact', async () => {
    const page = await collectTimelinePage({
      impact: 'task',
      limit: 1,
      pageSize: 1,
      fetchPage: ({ cursor }) =>
        Promise.resolve(
          cursor === null
            ? {
                items: [
                  event('email-newer', '2026-05-28T12:00:00.000Z', {
                    source: 'email',
                    sourceMetadata: { thread_root_id: 'thread-1' },
                  }),
                ],
                nextCursor: 'older',
              }
            : {
                items: [
                  event('email-older', '2026-05-28T11:00:00.000Z', {
                    source: 'email',
                    sourceMetadata: { thread_root_id: 'thread-1' },
                  }),
                ],
                nextCursor: 'next',
              },
        ),
      hydrateImpact: (ids) =>
        Promise.resolve(
          Object.fromEntries(
            ids.map((id) => [
              id,
              id === 'email-older' ? [{ kind: 'task' as const, label: id }] : [],
            ]),
          ),
        ),
    });

    expect(page.items.map((item) => item.id)).toEqual(['email-newer', 'email-older']);
    expect(page.nextCursor).toBe('next');
  });

  it('includes a focused event outside the normal page window', async () => {
    const page = await collectTimelinePage({
      focusEventId: 'focused',
      fetchPage: () =>
        Promise.resolve({
          items: [event('newest', '2026-05-28T12:00:00.000Z')],
          nextCursor: null,
        }),
      fetchEventsByIds: (ids) =>
        Promise.resolve(ids.map((id) => event(id, '2026-05-27T12:00:00.000Z'))),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual(['newest', 'focused']);
    expect(page.impactItems).toEqual({ newest: [], focused: [] });
  });

  it('hydrates the full deterministic moment for a focused event outside the page window', async () => {
    const page = await collectTimelinePage({
      focusEventId: 'focused-email',
      fetchPage: () =>
        Promise.resolve({
          items: [event('newest', '2026-05-28T12:00:00.000Z')],
          nextCursor: null,
        }),
      fetchEventsByIds: (ids) =>
        Promise.resolve(
          ids.map((id) =>
            event(id, '2026-05-27T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ),
        ),
      fetchRelatedEventsForFocus: (focused) =>
        Promise.resolve([
          focused,
          event('focused-email-sibling', '2026-05-27T11:00:00.000Z', {
            source: 'email',
            sourceMetadata: { thread_root_id: 'thread-1' },
          }),
          event('other-email-thread', '2026-05-27T10:00:00.000Z', {
            source: 'email',
            sourceMetadata: { thread_root_id: 'thread-2' },
          }),
        ]),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual([
      'newest',
      'focused-email',
      'focused-email-sibling',
    ]);
    expect(page.impactItems).toEqual({
      newest: [],
      'focused-email': [],
      'focused-email-sibling': [],
    });
  });

  it('hydrates focused moment siblings while impact filters are active', async () => {
    const fetchRelatedEventsForFocus = vi.fn((focused: TimelineEvent) =>
      Promise.resolve([
        focused,
        event('focused-email-sibling', '2026-05-27T11:00:00.000Z', {
          source: 'email',
          sourceMetadata: { thread_root_id: 'thread-1' },
        }),
        event('other-email-thread', '2026-05-27T10:00:00.000Z', {
          source: 'email',
          sourceMetadata: { thread_root_id: 'thread-2' },
        }),
      ]),
    );

    const page = await collectTimelinePage({
      impact: 'task',
      focusEventId: 'focused-email',
      fetchPage: () =>
        Promise.resolve({
          items: [event('task-event', '2026-05-28T12:00:00.000Z')],
          nextCursor: null,
        }),
      fetchEventsByIds: (ids) =>
        Promise.resolve(
          ids.map((id) =>
            event(id, '2026-05-27T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ),
        ),
      fetchRelatedEventsForFocus,
      hydrateImpact: (ids) =>
        Promise.resolve(
          Object.fromEntries(
            ids.map((id) => [
              id,
              id === 'task-event' ? [{ kind: 'task' as const, label: 'Follow up' }] : [],
            ]),
          ),
        ),
    });

    expect(fetchRelatedEventsForFocus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'focused-email' }),
    );
    expect(page.items.map((item) => item.id)).toEqual([
      'task-event',
      'focused-email',
      'focused-email-sibling',
    ]);
    expect(page.impactItems).toEqual({
      'task-event': [{ kind: 'task', label: 'Follow up' }],
      'focused-email': [],
      'focused-email-sibling': [],
    });
  });

  it('hydrates a focused moment id from a bounded lookup source', async () => {
    const focusMomentId = 'moment:telegram:chat-a:2026-06-27:18:00';
    const page = await collectTimelinePage({
      focusMomentId,
      timezone: 'UTC',
      fetchPage: () =>
        Promise.resolve({
          items: [event('newest', '2026-06-28T12:00:00.000Z')],
          nextCursor: null,
        }),
      fetchEventsForMoment: (momentId) =>
        Promise.resolve(
          momentId === focusMomentId
            ? [
                event('message-a', '2026-06-27T18:08:00.000Z', {
                  source: 'telegram',
                  sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Tim' },
                }),
                event('message-b', '2026-06-27T18:03:00.000Z', {
                  source: 'telegram',
                  sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Mikael' },
                }),
                event('message-other-bucket', '2026-06-27T18:30:00.000Z', {
                  source: 'telegram',
                  sourceMetadata: { tg_chat_id: 'chat-a', tg_sender_name: 'Otto' },
                }),
              ]
            : [],
        ),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual(['newest', 'message-a', 'message-b']);
  });

  it('does not hydrate focused moment siblings in source event mode', async () => {
    const page = await collectTimelinePage({
      mode: 'events',
      focusEventId: 'focused-email',
      fetchPage: () =>
        Promise.resolve({
          items: [event('newest', '2026-05-28T12:00:00.000Z')],
          nextCursor: null,
        }),
      fetchEventsByIds: (ids) =>
        Promise.resolve(
          ids.map((id) =>
            event(id, '2026-05-27T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ),
        ),
      fetchRelatedEventsForFocus: () => {
        throw new Error('source event mode should not request related moment events');
      },
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual(['newest', 'focused-email']);
  });

  it('expands normal moment pages across raw page boundaries', async () => {
    const pages = new Map([
      [
        null,
        {
          items: [
            event('email-newer', '2026-05-28T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ],
          nextCursor: 'older-sibling',
        },
      ],
      [
        'older-sibling',
        {
          items: [
            event('email-older', '2026-05-28T11:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ],
          nextCursor: 'next-moment',
        },
      ],
      [
        'next-moment',
        {
          items: [event('separate', '2026-05-28T10:00:00.000Z')],
          nextCursor: 'after-selected-moment',
        },
      ],
    ]);

    const page = await collectTimelinePage({
      limit: 1,
      pageSize: 1,
      cursorForEvent: (item) => `after-${item.id}`,
      fetchPage: ({ cursor }) =>
        Promise.resolve(pages.get(cursor) ?? { items: [], nextCursor: null }),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual(['email-newer', 'email-older']);
    expect(page.nextCursor).toBe('after-email-older');
    expect(page.impactItems).toEqual({ 'email-newer': [], 'email-older': [] });
  });

  it('continues after the current moment when a raw page mixes a sibling and the next moment', async () => {
    const pages = new Map([
      [
        null,
        {
          items: [
            event('email-newer', '2026-05-28T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ],
          nextCursor: 'after-email-newer',
        },
      ],
      [
        'after-email-newer',
        {
          items: [
            event('email-older', '2026-05-28T10:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
            event('separate', '2026-05-28T11:00:00.000Z'),
          ],
          nextCursor: 'after-separate',
        },
      ],
      [
        'after-separate',
        {
          items: [
            event('email-older', '2026-05-28T10:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ],
          nextCursor: null,
        },
      ],
    ]);
    const loadPage = (cursor: string | null) =>
      pages.get(cursor) ?? { items: [], nextCursor: null };

    const firstPage = await collectTimelinePage({
      limit: 1,
      pageSize: 2,
      cursorForEvent: (item) => `after-${item.id}`,
      fetchPage: ({ cursor }) => Promise.resolve(loadPage(cursor)),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    const secondPage = await collectTimelinePage({
      cursor: firstPage.nextCursor,
      limit: 1,
      pageSize: 2,
      cursorForEvent: (item) => `after-${item.id}`,
      fetchPage: ({ cursor }) => Promise.resolve(loadPage(cursor)),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(firstPage.items.map((item) => item.id)).toEqual(['email-newer', 'email-older']);
    expect(firstPage.nextCursor).toBe('after-email-newer');
    expect(secondPage.items.map((item) => item.id)).toEqual(['separate']);
    expect(secondPage.nextCursor).toBe('after-separate');
  });

  it('keeps a moment cursor when the last raw page is short but moments overflow the limit', async () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      event(`web-${String(index + 1)}`, `2026-05-28T12:0${String(5 - index)}:00.000Z`),
    );

    function loadPage(cursor: string | null) {
      const start = cursor ? events.findIndex((item) => `after-${item.id}` === cursor) + 1 : 0;
      return {
        items: events.slice(Math.max(start, 0)),
        nextCursor: null,
      };
    }

    const firstPage = await collectTimelinePage({
      limit: 3,
      pageSize: 10,
      cursorForEvent: (item) => `after-${item.id}`,
      fetchPage: ({ cursor }) => Promise.resolve(loadPage(cursor)),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });
    const secondPage = await collectTimelinePage({
      cursor: firstPage.nextCursor,
      limit: 3,
      pageSize: 10,
      cursorForEvent: (item) => `after-${item.id}`,
      fetchPage: ({ cursor }) => Promise.resolve(loadPage(cursor)),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(firstPage.items.map((item) => item.id)).toEqual(['web-1', 'web-2', 'web-3']);
    expect(firstPage.nextCursor).toBe('after-web-3');
    expect(firstPage.diagnostics.boundaryCursorAdjusted).toBe(true);
    expect(secondPage.items.map((item) => item.id)).toEqual(['web-4', 'web-5']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('keeps source event mode raw and page-sized', async () => {
    const page = await collectTimelinePage({
      mode: 'events',
      limit: 1,
      pageSize: 1,
      fetchPage: () =>
        Promise.resolve({
          items: [
            event('email-newer', '2026-05-28T12:00:00.000Z', {
              source: 'email',
              sourceMetadata: { thread_root_id: 'thread-1' },
            }),
          ],
          nextCursor: 'older-sibling',
        }),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.items.map((item) => item.id)).toEqual(['email-newer']);
    expect(page.nextCursor).toBe('older-sibling');
  });

  it('summarizes missing provider metadata in moment diagnostics', async () => {
    const page = await collectTimelinePage({
      fetchPage: () =>
        Promise.resolve({
          items: [
            event('weak-provider-event', '2026-05-28T12:00:00.000Z', {
              source: 'integration',
              sourceMetadata: {
                provider: 'github',
                event_type: 'workflow_run.success',
                github: { type: 'workflow_run' },
              },
            }),
          ],
          nextCursor: null,
        }),
      hydrateImpact: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
    });

    expect(page.diagnostics.providerMetadata).toMatchObject({
      total: 1,
      affectedEventCount: 1,
      byProvider: {
        github: {
          count: 1,
          missingFields: {
            'github.repo': 1,
            'github.head_branch': 1,
            'github.workflow_name': 1,
          },
        },
      },
    });
    expect(page.diagnostics.providerMetadata.diagnostics[0]).toMatchObject({
      eventId: 'weak-provider-event',
      groupingStrategy: 'provider_workflow_window',
    });
  });

  it('applies cached AI presentation to server-built moments by cache fingerprint', async () => {
    const [moment] = buildTimelineMoments(
      [
        event('message-a', '2026-06-27T18:00:00.000Z', {
          source: 'telegram',
          contentText: 'Can we meet at 16:20?',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-b', '2026-06-27T18:01:00.000Z', {
          source: 'telegram',
          contentText: '16:20 works.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-c', '2026-06-27T18:02:00.000Z', {
          source: 'telegram',
          contentText: 'Booked.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
      ],
      new Map(),
    ) as TimelineMoment[];
    if (!moment) throw new Error('expected moment');
    const cacheKey = buildTimelineMomentPresentationCacheKey({ teamId: TEAM_ID, moment });
    const cacheFingerprint = buildTimelineMomentPresentationCacheFingerprint(cacheKey);

    const cacheStats = vi.fn();
    const [presented] = await applyCachedTimelineMomentPresentations([moment], {
      teamId: TEAM_ID,
      listMomentPresentations: () =>
        Promise.resolve({
          [cacheFingerprint]: {
            cacheKey,
            cacheFingerprint,
            suggestion: {
              title: '16:20 meeting booked',
              summary: 'The group agreed to meet at 16:20.',
              previewEventIds: ['message-a', 'message-b'],
              topicLabels: ['scheduling'],
              impactHints: [],
              crossSourceLinks: [],
            },
          },
        }),
      onCacheStats: cacheStats,
    });

    expect(presented).toMatchObject({
      title: '16:20 meeting booked',
      preview: 'The group agreed to meet at 16:20.',
      confidence: 'ai_suggested',
    });
    expect(cacheStats).toHaveBeenCalledWith({
      hitCount: 1,
      missCount: 0,
      staleCount: 0,
      eligibleMissCount: 0,
      queuedMissingCount: 0,
      visibilityPartitionCount: 1,
    });

    const staleStats = vi.fn();
    const [stale] = await applyCachedTimelineMomentPresentations([moment], {
      teamId: TEAM_ID,
      listMomentPresentations: () =>
        Promise.resolve({
          [cacheFingerprint]: {
            cacheKey: { ...cacheKey, visibleSourceContentHash: 'stale' },
            cacheFingerprint,
            suggestion: {
              title: 'Stale title',
              summary: 'This should not render.',
              previewEventIds: ['message-a'],
              topicLabels: [],
              impactHints: [],
              crossSourceLinks: [],
            },
          },
        }),
      onCacheStats: staleStats,
    });

    expect(stale).toBe(moment);
    expect(staleStats).toHaveBeenCalledWith({
      hitCount: 0,
      missCount: 0,
      staleCount: 1,
      eligibleMissCount: 0,
      queuedMissingCount: 0,
      visibilityPartitionCount: 1,
    });
  });

  it('enqueues missing AI presentation only for eligible uncached moments', async () => {
    const [moment] = buildTimelineMoments(
      [
        event('message-a', '2026-06-27T18:00:00.000Z', {
          source: 'telegram',
          contentText: 'Can we meet at 16:20?',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-b', '2026-06-27T18:01:00.000Z', {
          source: 'telegram',
          contentText: '16:20 works.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-c', '2026-06-27T18:02:00.000Z', {
          source: 'telegram',
          contentText: 'Booked.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
      ],
      new Map(),
    ) as TimelineMoment[];
    if (!moment) throw new Error('expected moment');
    const enqueueMissingPresentation = vi.fn(() => Promise.resolve());

    const cacheStats = vi.fn();
    const [presented] = await applyCachedTimelineMomentPresentations([moment], {
      teamId: TEAM_ID,
      listMomentPresentations: () => Promise.resolve({}),
      enqueueMissingPresentation,
      onCacheStats: cacheStats,
    });

    expect(presented).toBe(moment);
    expect(enqueueMissingPresentation).toHaveBeenCalledWith({
      cacheKey: buildTimelineMomentPresentationCacheKey({ teamId: TEAM_ID, moment }),
      rawEventIds: ['message-c', 'message-b', 'message-a'],
    });
    expect(cacheStats).toHaveBeenCalledWith({
      hitCount: 0,
      missCount: 1,
      staleCount: 0,
      eligibleMissCount: 1,
      queuedMissingCount: 1,
      visibilityPartitionCount: 1,
    });

    enqueueMissingPresentation.mockClear();
    cacheStats.mockClear();
    const [singleEventMoment] = buildTimelineMoments(
      [event('note-a', '2026-06-27T18:00:00.000Z', { contentText: 'Strong note.' })],
      new Map(),
    ) as TimelineMoment[];
    if (!singleEventMoment) throw new Error('expected single event moment');

    await applyCachedTimelineMomentPresentations([singleEventMoment], {
      teamId: TEAM_ID,
      listMomentPresentations: () => Promise.resolve({}),
      enqueueMissingPresentation,
      onCacheStats: cacheStats,
    });

    expect(enqueueMissingPresentation).not.toHaveBeenCalled();
    expect(cacheStats).toHaveBeenCalledWith({
      hitCount: 0,
      missCount: 1,
      staleCount: 0,
      eligibleMissCount: 0,
      queuedMissingCount: 0,
      visibilityPartitionCount: 1,
    });
  });

  it('does not wait for slow missing-presentation enqueue work', async () => {
    const [moment] = buildTimelineMoments(
      [
        event('message-a', '2026-06-27T18:00:00.000Z', {
          source: 'telegram',
          contentText: 'Can we meet at 16:20?',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-b', '2026-06-27T18:01:00.000Z', {
          source: 'telegram',
          contentText: '16:20 works.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
        event('message-c', '2026-06-27T18:02:00.000Z', {
          source: 'telegram',
          contentText: 'Booked.',
          sourceMetadata: { tg_chat_id: 'chat-a' },
        }),
      ],
      new Map(),
    ) as TimelineMoment[];
    if (!moment) throw new Error('expected moment');
    const enqueueMissingPresentation = vi.fn(() => new Promise<void>(() => undefined));

    const [presented] = await applyCachedTimelineMomentPresentations([moment], {
      teamId: TEAM_ID,
      listMomentPresentations: () => Promise.resolve({}),
      enqueueMissingPresentation,
    });

    expect(presented).toBe(moment);
    expect(enqueueMissingPresentation).toHaveBeenCalledTimes(1);
  });
});
