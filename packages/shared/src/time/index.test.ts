import { describe, expect, it } from 'vitest';

import {
  dateOnlyEventRange,
  localDateFromInstant,
  localDateSpanToUtcRange,
  presentDueDate,
  resolveTimePhrase,
  workspaceDueDateBoundaries,
  workspaceTimeContext,
} from '#src/time/index.js';

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
  it('extracts local dates from UTC instants in the target timezone', () => {
    expect(localDateFromInstant('2026-06-01T15:00:00.000Z', 'Asia/Tokyo')).toBe('2026-06-02');
    expect(localDateFromInstant('2026-06-02T04:00:00.000Z', 'America/New_York')).toBe('2026-06-02');
  });

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

describe('presentDueDate', () => {
  const now = new Date('2026-07-20T10:00:00.000Z');

  it('covers missing, overdue, today, due-soon, and scheduled states', () => {
    const options = { timezone: 'Europe/Madrid', now, locale: 'en' };
    expect(presentDueDate(null, options)).toMatchObject({
      status: 'missing',
      compactText: 'No due date',
      tone: 'muted',
    });
    expect(presentDueDate('2026-07-19', options)).toMatchObject({
      status: 'overdue',
      compactText: 'Overdue Jul 19, 2026',
      tone: 'danger',
    });
    expect(presentDueDate('2026-07-20', options)).toMatchObject({
      status: 'today',
      compactText: 'Due today Jul 20, 2026',
      tone: 'signal',
    });
    expect(presentDueDate('2026-08-03', options)).toMatchObject({ status: 'due_soon' });
    expect(presentDueDate('2026-08-04', options)).toMatchObject({ status: 'scheduled' });
  });

  it('preserves canonical midnight UTC calendar dates across timezones', () => {
    for (const timezone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(
        presentDueDate('2026-07-20T00:00:00.000Z', { timezone, now, locale: 'en' }),
      ).toMatchObject({ dateKey: '2026-07-20', dateLabel: 'Jul 20, 2026' });
    }
  });

  it('converts non-midnight instants into the workspace calendar date', () => {
    expect(
      presentDueDate('2026-07-20T22:30:00.000Z', {
        timezone: 'Europe/Madrid',
        now,
        locale: 'en',
      }),
    ).toMatchObject({ dateKey: '2026-07-21', dateLabel: 'Jul 21, 2026' });
  });

  it('changes from today to overdue at workspace-local midnight across DST', () => {
    const value = '2026-03-29T00:00:00.000Z';
    expect(
      presentDueDate(value, {
        timezone: 'Europe/Madrid',
        now: new Date('2026-03-29T21:59:59.000Z'),
      }).status,
    ).toBe('today');
    expect(
      presentDueDate(value, {
        timezone: 'Europe/Madrid',
        now: new Date('2026-03-29T22:00:00.000Z'),
      }).status,
    ).toBe('overdue');
  });

  it('falls back to UTC for invalid timezones and preserves invalid values', () => {
    expect(
      presentDueDate('2026-07-20', { timezone: 'Not/A_Timezone', now, locale: 'en' }),
    ).toMatchObject({ dateKey: '2026-07-20', status: 'today' });
    expect(presentDueDate('not-a-date', { timezone: 'UTC', now })).toMatchObject({
      status: 'invalid',
      compactText: 'Due not-a-date',
    });
    expect(presentDueDate(new Date('invalid'), { timezone: 'UTC', now })).toMatchObject({
      status: 'invalid',
      compactText: 'Due Invalid Date',
    });
  });

  it('derives stable workspace-local filter boundaries', () => {
    expect(workspaceDueDateBoundaries('America/Los_Angeles', now)).toEqual({
      today: '2026-07-20',
      tomorrow: '2026-07-21',
      next7: '2026-07-27',
      dueSoonEnd: '2026-08-04',
    });
  });
});
