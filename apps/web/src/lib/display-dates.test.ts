import { describe, expect, it } from 'vitest';

import { displayText, formatDisplayDate, formatDisplayDateTime } from '@/lib/display-dates';

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
});

describe('formatDisplayDateTime', () => {
  it('uses the requested workspace timezone across a date boundary', () => {
    const value = new Date('2026-07-15T00:30:00.000Z');
    expect(formatDisplayDateTime(value, { timezone: 'America/Los_Angeles' })).toContain(
      'Jul 14, 2026',
    );
  });
});
