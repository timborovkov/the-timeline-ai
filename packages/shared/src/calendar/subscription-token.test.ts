import { describe, expect, it } from 'vitest';

import {
  calendarSubscriptionHashesMatch,
  hashCalendarSubscriptionToken,
  isCalendarSubscriptionToken,
  mintCalendarSubscriptionToken,
} from '#src/calendar/subscription-token.js';

// Calendar subscription URLs are bearer credentials, so these tests pin the
// public token shape and hash-only comparison contract that protects stored rows.
describe('calendar subscription tokens', () => {
  it('mints tlcal bearer tokens with a stored prefix and SHA-256 hash', () => {
    const token = mintCalendarSubscriptionToken();

    expect(token.plaintext).toMatch(/^tlcal_/);
    expect(token.prefix).toBe(token.plaintext.slice(0, 'tlcal_'.length + 8));
    expect(token.hash).toBe(hashCalendarSubscriptionToken(token.plaintext));
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.hash).not.toContain(token.plaintext);
    expect(token.prefix).not.toBe(token.plaintext);
  });

  it('recognizes only calendar feed tokens by prefix', () => {
    expect(isCalendarSubscriptionToken('tlcal_example')).toBe(true);
    expect(isCalendarSubscriptionToken('tlmcp_example')).toBe(false);
    expect(isCalendarSubscriptionToken('example')).toBe(false);
  });

  it('compares token hashes without accepting different or malformed hashes', () => {
    const first = hashCalendarSubscriptionToken('tlcal_first');
    const second = hashCalendarSubscriptionToken('tlcal_second');

    expect(calendarSubscriptionHashesMatch(first, first)).toBe(true);
    expect(calendarSubscriptionHashesMatch(first, second)).toBe(false);
    expect(calendarSubscriptionHashesMatch(first, first.slice(0, -2))).toBe(false);
  });
});
