import { describe, expect, it } from 'vitest';

import { defaultDigestWindow } from '#src/messaging/digest.js';

describe('daily digest defaults', () => {
  it('uses the most recent noon UTC boundary with a 25h lookback', () => {
    expect(defaultDigestWindow(new Date('2026-06-14T13:00:00Z'))).toEqual({
      start: new Date('2026-06-13T11:00:00Z'),
      end: new Date('2026-06-14T12:00:00Z'),
    });
    expect(defaultDigestWindow(new Date('2026-06-14T11:00:00Z'))).toEqual({
      start: new Date('2026-06-12T11:00:00Z'),
      end: new Date('2026-06-13T12:00:00Z'),
    });
  });
});
