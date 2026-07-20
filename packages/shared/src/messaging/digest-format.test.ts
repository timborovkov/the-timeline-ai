import { describe, expect, it } from 'vitest';

import { formatDigestTask } from '#src/messaging/digest-format.js';

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
