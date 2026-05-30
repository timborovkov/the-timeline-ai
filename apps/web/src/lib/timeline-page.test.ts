import { describe, expect, it } from 'vitest';

import type { TimelineEvent } from '@/lib/use-paginated-queries';

import { collectTimelinePage } from '@/lib/timeline-page';

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
});
