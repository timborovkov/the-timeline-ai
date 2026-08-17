import { describe, expect, it } from 'vitest';

import { dateInputValue, isoTimestamp, toDateOrNull } from '@/lib/iso-timestamp';

describe('isoTimestamp', () => {
  it('keeps already-serialized RSC date strings', () => {
    expect(isoTimestamp('2026-07-19T12:00:00.000Z')).toBe('2026-07-19T12:00:00.000Z');
  });

  it('serializes Date values', () => {
    expect(isoTimestamp(new Date('2026-07-19T12:00:00.000Z'))).toBe('2026-07-19T12:00:00.000Z');
  });

  it('treats empty values as missing', () => {
    expect(isoTimestamp(null)).toBeUndefined();
    expect(isoTimestamp(undefined)).toBeUndefined();
    expect(isoTimestamp('')).toBeUndefined();
  });
});

describe('dateInputValue', () => {
  it('uses the UTC calendar date from Date or string values', () => {
    expect(dateInputValue(new Date('2026-07-19T12:00:00.000Z'))).toBe('2026-07-19');
    expect(dateInputValue('2026-07-19T12:00:00.000Z')).toBe('2026-07-19');
  });
});

describe('toDateOrNull', () => {
  it('revives serialized dates without throwing', () => {
    const revived = toDateOrNull('2026-07-19T12:00:00.000Z');
    expect(revived?.toISOString()).toBe('2026-07-19T12:00:00.000Z');
    expect(toDateOrNull(null)).toBeNull();
  });
});
