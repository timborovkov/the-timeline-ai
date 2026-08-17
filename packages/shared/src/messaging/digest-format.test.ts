import { describe, expect, it } from 'vitest';

import {
  absoluteDigestAppUrl,
  canonicalDigestSectionTitle,
  collapseDigestCalendarEvents,
  digestActivityStats,
  digestAppHref,
  digestCalendarHref,
  digestContainsBannedInventory,
  digestContentSections,
  formatDigestActivityLines,
  formatDigestCalendarEvent,
  formatDigestChatText,
  formatDigestTask,
  formatDigestWindowRange,
  scrubDigestArtifactIds,
} from '#src/messaging/digest-format.js';

const NOW = new Date('2026-07-20T12:00:00.000Z');

describe('formatDigestActivityLines', () => {
  it('omits zero counts and keeps the new-work totals', () => {
    expect(
      formatDigestActivityLines({
        newMoments: 10,
        newProposals: 0,
        pendingApprovals: 1,
        newTasks: 2,
        completedTasks: 0,
        newProjects: 1,
        newObjectsByType: { task: 2, project: 1, person: 0, deal: 3 },
      }),
    ).toEqual([
      '10 new moments',
      '1 pending approval',
      '2 new tasks',
      '1 new project',
      '3 new deals',
    ]);
  });

  it('hides activity entirely when every count is zero', () => {
    expect(
      formatDigestActivityLines({
        newMoments: 0,
        newProposals: 0,
        pendingApprovals: 0,
        newTasks: 0,
        completedTasks: 0,
        newProjects: 0,
        newObjectsByType: {},
      }),
    ).toEqual([]);
  });

  it('fills pending approvals from the payload when stored activity omitted them', () => {
    expect(
      formatDigestActivityLines(
        digestActivityStats({
          pendingApprovals: 3,
          eventCount: 1,
          tasks: [],
          objectChangesByType: {},
          activity: {
            newMoments: 1,
            newProposals: 0,
            newTasks: 0,
            completedTasks: 0,
            newProjects: 0,
            newObjectsByType: {},
          },
        }),
      ),
    ).toEqual(['1 new moment', '3 pending approvals']);
  });

  it('does not treat legacy pending approvals or open tasks as new work', () => {
    expect(
      formatDigestActivityLines(
        digestActivityStats({
          pendingApprovals: 4,
          eventCount: 12,
          tasks: [
            {
              id: 'task-1',
              title: 'Standing backlog',
              status: 'todo',
              dueAt: null,
              href: '/app/objects/task-1',
            },
          ],
          objectChangesByType: { task: 9, project: 2 },
        }),
      ),
    ).toEqual(['12 new moments', '4 pending approvals']);
  });
});

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

describe('digestAppHref', () => {
  it('keeps dashboard and nested app paths and rejects protocol-relative hrefs', () => {
    expect(digestAppHref('/app')).toBe('/app');
    expect(digestAppHref('/app/objects/t1')).toBe('/app/objects/t1');
    expect(digestAppHref('/app/timeline')).toBe('/app/timeline');
    expect(digestAppHref('//evil.test/app/x')).toBeNull();
    expect(digestAppHref('/application')).toBeNull();
    expect(digestAppHref('https://timeline.test/app/objects/t1')).toBeNull();
  });
});

describe('absoluteDigestAppUrl', () => {
  it('resolves app paths against the digest origin and rejects off-origin hrefs', () => {
    expect(
      absoluteDigestAppUrl('https://timeline.test/app/digests?digest=d1', '/app/objects/t1'),
    ).toBe('https://timeline.test/app/objects/t1');
    expect(absoluteDigestAppUrl('https://timeline.test/app/digests', '/app')).toBe(
      'https://timeline.test/app',
    );
    expect(
      absoluteDigestAppUrl(
        'https://timeline.test/app/digests',
        'https://timeline.test/app/calendar',
      ),
    ).toBe('https://timeline.test/app/calendar');
    expect(
      absoluteDigestAppUrl('https://timeline.test/app/digests', 'https://evil.test/app/objects/t1'),
    ).toBeNull();
    expect(
      absoluteDigestAppUrl('https://timeline.test/app/digests', '//evil.test/app/x'),
    ).toBeNull();
  });
});

describe('collapseDigestCalendarEvents', () => {
  it('keeps one-off events and collapses a repeating series to the next occurrence', () => {
    const collapsed = collapseDigestCalendarEvents([
      {
        id: 'occ-1',
        title: 'Internal daily call',
        startAt: '2026-08-17T08:00:00.000Z',
        endAt: '2026-08-17T08:30:00.000Z',
        recurringParentId: 'series-1',
      },
      {
        id: 'occ-2',
        title: 'Internal daily call',
        startAt: '2026-08-18T08:00:00.000Z',
        endAt: '2026-08-18T08:30:00.000Z',
        recurringParentId: 'series-1',
      },
      {
        id: 'retreat',
        title: 'Team retreat',
        startAt: '2026-08-17T12:00:00.000Z',
        endAt: '2026-08-21T16:00:00.000Z',
      },
    ]);

    expect(collapsed).toEqual([
      {
        id: 'series-1',
        title: 'Internal daily call',
        startAt: '2026-08-17T08:00:00.000Z',
        endAt: '2026-08-17T08:30:00.000Z',
        href: '/app/calendar',
        repeating: true,
        occurrenceCount: 2,
      },
      {
        id: 'retreat',
        title: 'Team retreat',
        startAt: '2026-08-17T12:00:00.000Z',
        endAt: '2026-08-21T16:00:00.000Z',
        href: '/app/calendar',
      },
    ]);
    const repeating = collapsed[0];
    expect(repeating).toBeDefined();
    if (!repeating) return;
    expect(formatDigestCalendarEvent(repeating, 'UTC')).toContain('repeating · next');
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
    ).toContain('Jun 14, 2026');
    expect(
      formatDigestChatText({
        payload,
        digestUrl: 'https://timeline.test/app',
      }),
    ).toContain('Covering');
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

  it('renders narrative section bodies without turning them into bullets', () => {
    const text = formatDigestChatText({
      payload: {
        ...payload,
        sections: [
          {
            title: 'Highlights',
            body: 'The invite flow shipped after customer notes landed.',
            items: [],
          },
        ],
      },
      digestUrl: 'https://timeline.test/app',
    });
    expect(text).toContain('The invite flow shipped after customer notes landed.');
    expect(text).not.toContain('• The invite flow shipped');
  });
});

describe('digestContainsBannedInventory', () => {
  it('rejects pull-request numbers, SHAs, CI runs, tickets, and UUIDs', () => {
    expect(digestContainsBannedInventory('Merged #412 and #413.')).toBe(true);
    expect(digestContainsBannedInventory('Shipped PR 88 after review.')).toBe(true);
    expect(digestContainsBannedInventory('Deployed abcdef0 to production.')).toBe(true);
    expect(digestContainsBannedInventory('CI run 998877 finished green.')).toBe(true);
    expect(digestContainsBannedInventory('Moved ENG-441 to done.')).toBe(true);
    expect(digestContainsBannedInventory('Opened 11111111-1111-1111-1111-111111111111.')).toBe(
      true,
    );
    expect(
      digestContainsBannedInventory(
        'The login timeout fix shipped after review. Invite copy still needs an owner.',
      ),
    ).toBe(false);
    expect(digestContainsBannedInventory('The #1 priority is the invite copy.')).toBe(false);
  });
});

describe('scrubDigestArtifactIds', () => {
  it('strips PR numbers and ticket keys from moment titles', () => {
    expect(scrubDigestArtifactIds('Merged login timeout fix #412')).toBe(
      'Merged login timeout fix',
    );
    expect(scrubDigestArtifactIds('Legal review ENG-441 for Atlas')).toBe('Legal review for Atlas');
  });
});

describe('canonicalDigestSectionTitle', () => {
  it('remaps product status to status', () => {
    expect(canonicalDigestSectionTitle('Product status')).toBe('Status');
    expect(canonicalDigestSectionTitle('Highlights')).toBe('Highlights');
  });
});

describe('digestContentSections', () => {
  it('drops empty sections and remaps product status', () => {
    expect(
      digestContentSections({
        summary: 'Overview.',
        sections: [
          { title: 'Product status', body: 'The invite flow is close.', items: [] },
          { title: 'Risks', body: '   ', items: [] },
          { title: 'Completed', body: 'The recap went out.', items: [] },
        ],
      }).map((section) => section.title),
    ).toEqual(['Status', 'Completed']);
  });
});

describe('formatDigestWindowRange', () => {
  it('renders the digest window as a local time range', () => {
    expect(
      formatDigestWindowRange('2026-06-13T11:00:00.000Z', '2026-06-14T12:00:00.000Z', 'UTC'),
    ).toContain('Jun 13');
    expect(
      formatDigestWindowRange('2026-06-13T11:00:00.000Z', '2026-06-14T12:00:00.000Z', 'UTC'),
    ).toContain('Jun 14');
  });
});

describe('digestCalendarHref', () => {
  it('opens the specific calendar event on the dashboard', () => {
    expect(digestCalendarHref({ id: 'cal-1', startAt: '2026-07-17T08:00:00.000Z' }, 'UTC')).toBe(
      '/app/calendar?view=day&date=2026-07-17&event=cal-1',
    );
  });
});
