import {
  formatDisplayCurrency,
  formatDisplayNumber,
  formatDisplayPercent,
  resolveRegionalFormat,
} from '@/lib/regional-format';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  displayText,
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayTime,
  formatRelativeAge,
} from '@/lib/display-dates';
const RAW_ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

describe('displayText', () => {
  it('does not rewrite embedded ISO instants without an explicit workspace timezone', () => {
    const value = 'Meeting with Miika | 2026-07-01T00:00:00.000Z';

    expect(displayText(value)).toBe(value);
  });

  it('formats embedded ISO instants in the requested timezone', () => {
    const text = displayText('Deadline 2026-07-01T00:00:00.000Z', {
      timezone: 'America/Los_Angeles',
    });

    expect(text).toContain('Deadline');
    expect(text).toContain('Jun 30, 2026');
    expect(text).not.toMatch(RAW_ISO_INSTANT);
  });
});

describe('formatDisplayDate', () => {
  it('formats standalone dates without exposing ISO strings', () => {
    const text = formatDisplayDate(new Date('2026-07-01T00:00:00.000Z'), {
      timezone: 'Europe/Helsinki',
    });

    expect(text).not.toMatch(RAW_ISO_INSTANT);
    expect(text).not.toContain('T00:00:00');
  });

  it('formats standalone dates in the requested timezone', () => {
    const text = formatDisplayDate(new Date('2026-07-01T00:00:00.000Z'), {
      timezone: 'America/Los_Angeles',
    });

    expect(text).toBe('Jun 30, 2026');
  });

  it('stays stable when the runtime default locale is en-GB', () => {
    const value = new Date('2026-08-14T12:00:00.000Z');
    const descriptor = Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleDateString');
    const original = descriptor?.value as
      | ((
          this: Date,
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ) => string)
      | undefined;
    if (!descriptor || !original) {
      throw new Error('expected Date.prototype.toLocaleDateString');
    }

    Object.defineProperty(Date.prototype, 'toLocaleDateString', {
      ...descriptor,
      value(this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return original.call(this, locales ?? 'en-GB', options);
      },
    });

    try {
      expect(formatDisplayDate(value, { timezone: 'UTC' })).toBe('Aug 14, 2026');
      expect(formatDisplayDate(value, { timezone: 'UTC' })).not.toBe(
        original.call(value, 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }),
      );
    } finally {
      Object.defineProperty(Date.prototype, 'toLocaleDateString', descriptor);
    }
  });
});

describe('formatDisplayDateTime', () => {
  it('uses the requested workspace timezone across a date boundary', () => {
    const value = new Date('2026-07-15T00:30:00.000Z');
    expect(formatDisplayDateTime(value, { timezone: 'America/Los_Angeles' })).toContain(
      'Jul 14, 2026',
    );
  });

  it('stays stable when the runtime default locale is en-GB', () => {
    const value = new Date('2026-08-14T15:30:00.000Z');
    const descriptor = Object.getOwnPropertyDescriptor(Date.prototype, 'toLocaleString');
    const original = descriptor?.value as
      | ((
          this: Date,
          locales?: Intl.LocalesArgument,
          options?: Intl.DateTimeFormatOptions,
        ) => string)
      | undefined;
    if (!descriptor || !original) {
      throw new Error('expected Date.prototype.toLocaleString');
    }

    Object.defineProperty(Date.prototype, 'toLocaleString', {
      ...descriptor,
      value(this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return original.call(this, locales ?? 'en-GB', options);
      },
    });

    try {
      const text = formatDisplayDateTime(value, { timezone: 'UTC' });
      expect(text).toContain('Aug 14, 2026');
      expect(text).not.toBe(
        original.call(value, 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }),
      );
    } finally {
      Object.defineProperty(Date.prototype, 'toLocaleString', descriptor);
    }
  });
});

describe('formatRelativeAge', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');

  it('uses auto relative units and keeps a week in days', () => {
    expect(formatRelativeAge(new Date('2026-08-17T11:59:40.000Z'), { now })).toBe('now');
    expect(formatRelativeAge(new Date('2026-08-17T11:10:00.000Z'), { now })).toBe('50 minutes ago');
    expect(formatRelativeAge(new Date('2026-08-17T09:00:00.000Z'), { now })).toBe('3 hours ago');
    expect(formatRelativeAge(new Date('2026-08-16T12:00:00.000Z'), { now })).toBe('yesterday');
    expect(formatRelativeAge(new Date('2026-08-10T12:00:00.000Z'), { now })).toBe('7 days ago');
    expect(formatRelativeAge(new Date('2026-06-17T12:00:00.000Z'), { now })).toBe('2 months ago');
  });

  it('returns the raw value when the instant is invalid', () => {
    expect(formatRelativeAge('not-a-date', { now })).toBe('not-a-date');
  });
});

describe('regional presentation', () => {
  it('independently resolves saved, browser, workspace, and app values', () => {
    const preference = { locale: 'invalid_locale', timezone: 'Mars/Olympus' };
    const browser = { locale: 'de-DE', timezone: 'America/Los_Angeles' };
    expect(resolveRegionalFormat(preference, browser, 'Asia/Tokyo')).toEqual(browser);
    expect(resolveRegionalFormat({ locale: 'en-US', timezone: 'Asia/Tokyo' }, browser)).toEqual({
      locale: 'en-US',
      timezone: 'Asia/Tokyo',
    });
    expect(resolveRegionalFormat(preference, {}, 'Asia/Tokyo')).toEqual({
      locale: 'en-US',
      timezone: 'Asia/Tokyo',
    });
    expect(resolveRegionalFormat(preference, {}, 'invalid')).toEqual({
      locale: 'en-US',
      timezone: 'Europe/Helsinki',
    });
  });

  it('keeps date-only values in their day and shows instant dates in each zone', () => {
    const west = { locale: 'en-US', timezone: 'America/Los_Angeles' };
    const east = { locale: 'de-DE', timezone: 'Asia/Tokyo' };
    const instant = '2026-07-01T00:15:00Z';
    expect(formatDisplayDate(instant, west)).toBe('Jun 30, 2026');
    expect(formatDisplayDate(instant, east)).toBe('01.07.2026');
    expect(formatDisplayDate('2026-07-01', west)).toBe('Jul 1, 2026');
    expect(formatDisplayDateTime('2026-07-01', east)).toBe('01.07.2026');
    expect(formatDisplayDateTime('2026-07-01T00:15:00', east)).toBe('2026-07-01T00:15:00');
  });

  it('uses real offsets on both sides of a DST jump', () => {
    const region = { locale: 'de-DE', timezone: 'America/New_York' };
    expect(formatDisplayTime('2026-03-08T06:59:00Z', region)).toBe('01:59');
    expect(formatDisplayTime('2026-03-08T07:00:00Z', region)).toBe('03:00');
    expect(formatDisplayTime('2026-03-08T03:00:00-04:00', region)).toBe('03:00');
  });

  it('localizes relative time, counts, and percentages while retaining USD', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(formatRelativeAge('2026-06-30T22:00:00Z', { now, locale: 'de-DE' })).toBe(
      'vor 2 Stunden',
    );
    expect(formatDisplayNumber(1234.5, 'de-DE')).toBe('1.234,5');
    expect(formatDisplayPercent(0.25, 'de-DE')).toBe('25\u00a0%');
    expect(formatDisplayCurrency(123450, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatDisplayCurrency(123450, 'USD', 'de-DE')).toBe('1.234,50\u00a0$');
  });
});
