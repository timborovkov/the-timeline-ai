import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIX = 'tlcal_';

export interface MintedCalendarSubscriptionToken {
  plaintext: string;
  prefix: string;
  hash: string;
}

export function mintCalendarSubscriptionToken(): MintedCalendarSubscriptionToken {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX.length + 8),
    hash: hashCalendarSubscriptionToken(plaintext),
  };
}

export function hashCalendarSubscriptionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isCalendarSubscriptionToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

export function calendarSubscriptionHashesMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
