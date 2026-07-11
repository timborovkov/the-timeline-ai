import { describe, expect, it } from 'vitest';

import { taskDisplayStatus, taskStatusFilterValues } from '@/lib/task-statuses';

describe('task statuses', () => {
  it.each([
    ['suggested', 'backlog'],
    ['proposed', 'backlog'],
    ['todo', 'open'],
    ['open', 'open'],
  ])('displays %s as %s', (source, display) => {
    expect(taskDisplayStatus(source)).toBe(display);
  });

  it.each(['completed', 'shipped', 'resolved', 'closed', 'canceled', 'archived'])(
    'does not reclassify the raw %s status as terminal',
    (status) => {
      expect(taskDisplayStatus(status)).toBe(status);
    },
  );

  it('expands simplified filters to legacy and imported values', () => {
    expect(taskStatusFilterValues(['backlog'])).toEqual(['backlog', 'suggested', 'proposed']);
    expect(taskStatusFilterValues(['open'])).toEqual(['open', 'todo']);
    expect(taskStatusFilterValues(['cancelled'])).toEqual(['cancelled', 'canceled']);
  });
});
