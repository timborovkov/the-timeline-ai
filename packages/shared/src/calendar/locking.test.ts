import { describe, expect, it } from 'vitest';

import { calendarEventMutationTargetId } from '#src/calendar/locking.js';

describe('calendarEventMutationTargetId', () => {
  it('uses the parent series for occurrence-wide mutations', () => {
    expect(calendarEventMutationTargetId('occurrence', 'parent', 'series')).toBe('parent');
    expect(calendarEventMutationTargetId('occurrence', 'parent', 'this_and_future')).toBe('parent');
  });

  it('keeps single-occurrence and direct-parent mutations on their own target', () => {
    expect(calendarEventMutationTargetId('occurrence', 'parent', 'single')).toBe('occurrence');
    expect(calendarEventMutationTargetId('occurrence', 'parent')).toBe('occurrence');
    expect(calendarEventMutationTargetId('parent', null, 'single')).toBe('parent');
    expect(calendarEventMutationTargetId('parent', null, 'series')).toBe('parent');
  });
});
