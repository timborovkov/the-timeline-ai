import { describe, expect, it } from 'vitest';

import { displayText, formatDisplayDate } from '@/lib/display-dates';

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
});

describe('formatDisplayDate', () => {
  it('formats standalone dates without exposing ISO strings', () => {
    const text = formatDisplayDate(new Date('2026-07-01T00:00:00.000Z'));

    expect(text).not.toMatch(RAW_ISO_INSTANT);
    expect(text).not.toContain('T00:00:00');
  });
});
