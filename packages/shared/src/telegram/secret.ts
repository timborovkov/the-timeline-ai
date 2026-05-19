import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of the X-Telegram-Bot-Api-Secret-Token header
 * against the configured webhook secret. Returns false if either side is
 * missing or empty, or if the lengths differ.
 */
export function verifyWebhookSecret(
  headerValue: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!headerValue || !expected) return false;
  const a = Buffer.from(headerValue, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
