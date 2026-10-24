import {
  parsePublicAnalyticsConsent,
  PUBLIC_ANALYTICS_CONSENT_COOKIE,
  PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS,
} from '@/lib/public-analytics-consent';
import { type PublicAttribution, readPublicAttributionCookie } from '@/lib/public-attribution';

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export function readConsentedPublicAttributionCookie(
  cookies: CookieReader,
  now = Date.now(),
): PublicAttribution | undefined {
  const consent = parsePublicAnalyticsConsent(
    cookies.get(PUBLIC_ANALYTICS_CONSENT_COOKIE)?.value,
    now,
  );
  if (
    consent?.choice !== 'accepted' ||
    now - consent.timestamp > PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS * 1_000
  ) {
    return undefined;
  }
  return readPublicAttributionCookie(cookies, now);
}
