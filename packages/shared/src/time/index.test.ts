import { describe, expect, it } from 'vitest';

import {
  dateOnlyEventRange,
  localDateSpanToUtcRange,
  resolveTimePhrase,
  workspaceTimeContext,
} from './index.js';

const REF = new Date('2026-05-27T10:00:00.000Z');

describe('workspaceTimeContext', () => {
  it('reports local today and ISO week in the workspace timezone', () => {
    expect(workspaceTimeContext('Europe/Tallinn', REF)).toMatchObject({
      timezone: 'Europe/Tallinn',
      today: '2026-05-27',
      isoWeek: 22,
      isoWeekYear: 2026,
    });
  });
});

describe('resolveTimePhrase', () => {
  it('resolves today, yesterday, and last week as local exclusive date spans', () => {
    expect(
      resolveTimePhrase('today', { timezone: 'Europe/Tallinn', referenceDate: REF }),
    ).toMatchObject({ localStartDate: '2026-05-27', localEndDate: '2026-05-28' });
    expect(
      resolveTimePhrase('yesterday', { timezone: 'Europe/Tallinn', referenceDate: REF }),
    ).toMatchObject({ localStartDate: '2026-05-26', localEndDate: '2026-05-27' });
    expect(
      resolveTimePhrase('last week', { timezone: 'Europe/Tallinn', referenceDate: REF }),
    ).toMatchObject({ localStartDate: '2026-05-18', localEndDate: '2026-05-25' });
  });

  it('resolves week numbers and next weekdays deterministically', () => {
    expect(resolveTimePhrase('week 24', { timezone: 'UTC', referenceDate: REF })).toMatchObject({
      localStartDate: '2026-06-08',
      localEndDate: '2026-06-15',
    });
    expect(
      resolveTimePhrase('next Tuesday', { timezone: 'UTC', referenceDate: REF }),
    ).toMatchObject({
      localStartDate: '2026-06-02',
      localEndDate: '2026-06-03',
    });
  });
});

describe('local date spans', () => {
  it('converts all-day event dates to exclusive UTC instants across DST', () => {
    const range = localDateSpanToUtcRange('2026-03-29', '2026-03-30', 'Europe/Tallinn');
    expect(range.from.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-03-29T21:00:00.000Z');
  });

  it('creates canonical date-only all-day event ranges', () => {
    const range = dateOnlyEventRange('2026-06-02', 'UTC');
    expect(range.allDay).toBe(true);
    expect(range.startAt.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(range.endAt.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });
});
