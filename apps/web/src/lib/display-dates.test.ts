import { describe, expect, it } from 'vitest';

import { displayText, formatDisplayDate, formatDisplayDateTime } from '@/lib/display-dates';

const RAW_ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

describe('displayText', () => {
  it('formats embedded ISO instants before showing text to users', () => {
    const text = displayText(
      'Meeting with Miika | 2026-07-01T00:00:00.000Z to 2026-07-02T00:00:00.000Z',
    );

    expect(text).toContain('Meeting with Miika');
    expect(text).toContain(' to ');
    expect(text).not.toMatch(RAW_ISO_INSTANT);
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
    const text = formatDisplayDate(new Date('2026-07-01T00:00:00.000Z'));

    expect(text).not.toMatch(RAW_ISO_INSTANT);
    expect(text).not.toContain('T00:00:00');
  });

  it('formats standalone dates in the requested timezone', () => {
    const text = formatDisplayDate(new Date('2026-07-01T00:00:00.000Z'), {
      timezone: 'America/Los_Angeles',
    });

    expect(text).toBe('Jun 30, 2026');
  });
});

describe('formatDisplayDateTime', () => {
  it('uses the workspace default timezone so server and browser hydration agree', () => {
    const value = new Date('2026-07-15T00:39:00.000Z');
    expect(formatDisplayDateTime(value)).toBe(
      formatDisplayDateTime(value, { timezone: 'Europe/Helsinki' }),
    );
  });
});
