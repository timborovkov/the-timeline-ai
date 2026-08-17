import { describe, expect, it } from 'vitest';

import { formatDigestChatText, formatDigestTask } from '#src/messaging/digest-format.js';

const NOW = new Date('2026-07-20T12:00:00.000Z');

describe('formatDigestTask', () => {
  it.each([
    [null, 'No due date'],
    ['2026-07-19T00:00:00.000Z', 'Overdue · Jul 19, 2026'],
    ['2026-07-20T00:00:00.000Z', 'Due today · Jul 20, 2026'],
    ['2026-07-28T00:00:00.000Z', 'Due soon · Jul 28, 2026'],
    ['2026-08-20T00:00:00.000Z', 'Due · Aug 20, 2026'],
  ])('renders the shared due state for %s', (dueAt, expected) => {
    expect(
      formatDigestTask(
        { id: 'task-1', title: 'Close review', status: 'todo', dueAt, href: '/task-1' },
        'America/Los_Angeles',
        NOW,
      ),
    ).toContain(expected);
  });
});

describe('formatDigestChatText', () => {
  const payload = {
    teamName: 'Acme Labs',
    userName: null,
    timezone: 'UTC',
    windowStart: '2026-06-13T12:00:00.000Z',
    windowEnd: '2026-06-14T12:00:00.000Z',
    summary: 'Pilot invites shipped. One blocker remains on billing.',
    sections: [{ title: 'Highlights' as const, items: ['Pilot invites shipped.'] }],
    pendingApprovals: 2,
    eventCount: 4,
    momentCount: 3,
    sourceDistribution: {},
    objectChangesByType: {},
    newTeamMembers: [],
    tasks: [
      {
        id: 'task-1',
        title: 'Close billing review',
        status: 'todo',
        dueAt: null,
        href: '/app/objects/task-1',
      },
    ],
    upcomingCalendar: [],
    links: [],
  };

  it('renders a compact bot-readable digest', () => {
    expect(
      formatDigestChatText({
        payload,
        digestUrl: 'https://timeline.test/app',
      }),
    ).toContain('Daily digest · Acme Labs');
    expect(
      formatDigestChatText({
        payload,
        digestUrl: 'https://timeline.test/app',
      }),
    ).toContain('• Pilot invites shipped.');
    expect(
      formatDigestChatText({
        payload,
        digestUrl: 'https://timeline.test/app',
      }),
    ).toContain('Open digest: https://timeline.test/app');
  });

  it('truncates long chat digests before the dashboard link', () => {
    const longPayload = {
      ...payload,
      summary: 'A'.repeat(200),
      sections: [
        {
          title: 'Highlights' as const,
          items: Array.from({ length: 6 }, (_, index) => `Item ${index + 1} ${'x'.repeat(80)}`),
        },
      ],
    };
    const text = formatDigestChatText({
      payload: longPayload,
      digestUrl: 'https://timeline.test/app',
      maxLength: 180,
    });
    expect(text.length).toBeLessThanOrEqual(180);
    expect(text.endsWith('Open digest: https://timeline.test/app')).toBe(true);
    expect(text).toContain('…');
  });
});
