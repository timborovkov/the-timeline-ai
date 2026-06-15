import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';

import { calendarEventListWindow } from '@/lib/calendar-event-list-range';

describe('calendarEventListWindow', () => {
  it('moves by local calendar days instead of fixed UTC days', () => {
    const window = calendarEventListWindow(
      'Europe/Helsinki',
      2,
      Temporal.PlainDate.from('2026-03-30'),
    );

    expect(window.today.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    expect(window.from.toISOString()).toBe('2026-03-27T22:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-03-31T21:00:00.000Z');
  });
});
