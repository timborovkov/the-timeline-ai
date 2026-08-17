import { describe, expect, it } from 'vitest';

import {
  collapseDigestCalendarEvents,
  digestActivityStats,
  formatDigestActivityLines,
  formatDigestCalendarEvent,
  formatDigestTask,
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
