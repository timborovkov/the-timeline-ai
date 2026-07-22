import { describe, expect, it } from 'vitest';

import { defaultDigestWindow, isDigestWindowExpired } from '#src/messaging/digest.js';

describe('daily digest defaults', () => {
  it('uses the most recent configured-hour boundary with a 25h lookback', () => {
    expect(defaultDigestWindow(new Date('2026-06-14T13:00:00Z'))).toEqual({
      start: new Date('2026-06-13T11:00:00Z'),
      end: new Date('2026-06-14T12:00:00Z'),
    });
    expect(defaultDigestWindow(new Date('2026-06-14T11:00:00Z'))).toEqual({
      start: new Date('2026-06-12T11:00:00Z'),
      end: new Date('2026-06-13T12:00:00Z'),
    });
    expect(defaultDigestWindow(new Date('2026-06-14T10:00:00Z'), 'Europe/Helsinki')).toEqual({
      start: new Date('2026-06-13T08:00:00Z'),
      end: new Date('2026-06-14T09:00:00Z'),
    });
    expect(defaultDigestWindow(new Date('2026-06-14T08:00:00Z'), 'Europe/Helsinki')).toEqual({
      start: new Date('2026-06-12T08:00:00Z'),
      end: new Date('2026-06-13T09:00:00Z'),
    });
  });

  it('expires digests once the next digest cycle has started', () => {
    const windowEnd = new Date('2026-06-14T12:00:00Z');
    expect(isDigestWindowExpired(windowEnd, new Date('2026-06-14T18:00:00Z'))).toBe(false);
    expect(isDigestWindowExpired(windowEnd, new Date('2026-06-15T11:59:00Z'))).toBe(false);
    expect(isDigestWindowExpired(windowEnd, new Date('2026-06-15T12:00:00Z'))).toBe(true);
    expect(isDigestWindowExpired(windowEnd, new Date('2026-06-21T15:00:00Z'))).toBe(true);
  });
});
