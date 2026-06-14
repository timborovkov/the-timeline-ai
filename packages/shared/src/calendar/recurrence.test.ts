import { describe, expect, it } from 'vitest';

import {
  expandRRuleBetween,
  recurrenceWindowFrom,
  validateRRule,
} from '#src/calendar/recurrence.js';

describe('calendar recurrence rules', () => {
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

  it('validates shorthand RRULE text', () => {
    const rrule = validateRRule({
      rrule: 'FREQ=DAILY;COUNT=2',
      startAt: new Date('2026-07-01T09:00:00.000Z'),
      timezone: 'UTC',
    });

    expect(rrule).toBe('RRULE:FREQ=DAILY;COUNT=2');
  });

  it('expands recurring dates between a window', () => {
    const dates = expandRRuleBetween({
      rrule: 'RRULE:FREQ=DAILY;COUNT=2',
      startAt: new Date('2026-07-01T09:00:00.000Z'),
      timezone: 'UTC',
      from: new Date('2026-07-01T00:00:00.000Z'),
      to: new Date('2026-07-03T00:00:00.000Z'),
    });

    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-07-01T09:00:00.000Z',
      '2026-07-02T09:00:00.000Z',
    ]);
  });
});
