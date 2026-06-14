import { describe, expect, it } from 'vitest';

import { recurrenceWindowFrom } from '#src/calendar/recurrence.js';

describe('recurrenceWindowFrom', () => {
  it('includes recent past occurrences for calendar grid queries', () => {
    const window = recurrenceWindowFrom(
      new Date('2026-01-01T16:00:00Z'),
      new Date('2026-06-14T12:00:00Z'),
    );

    expect(window.from.toISOString()).toBe('2026-03-14T12:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  it('does not materialize before a future series start', () => {
    const window = recurrenceWindowFrom(
      new Date('2026-07-01T16:00:00Z'),
      new Date('2026-06-14T12:00:00Z'),
    );

    expect(window.from.toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });
});
