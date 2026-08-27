import { describe, expect, it } from 'vitest';

import { PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS } from '@/lib/public-analytics-consent';
import { readConsentedPublicAttributionCookie } from '@/lib/public-attribution-server';

const NOW = Date.UTC(2026, 7, 21, 12);

function cookies(values: Record<string, string>) {
  return { get: (name: string) => (values[name] ? { value: values[name] } : undefined) };
}

describe('readConsentedPublicAttributionCookie', () => {
  it('returns bounded attribution only with a current affirmative consent record', () => {
    expect(
      readConsentedPublicAttributionCookie(
        cookies({
          tl_analytics_consent: `1|accepted|${NOW}`,
          tl_public_attribution: `2|${NOW}|newsletter|email|launch`,
        }),
        NOW,
      ),
    ).toEqual({ source: 'newsletter', medium: 'email', campaign: 'launch' });
  });

  it.each([
    undefined,
    `1|rejected|${NOW}`,
    `2|accepted|${NOW}`,
    `1|accepted|${NOW - (PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS + 1) * 1_000}`,
  ])('ignores attribution without current affirmative consent (%s)', (consent) => {
    expect(
      readConsentedPublicAttributionCookie(
        cookies({
          ...(consent ? { tl_analytics_consent: consent } : {}),
          tl_public_attribution: `2|${NOW}|newsletter|email|launch`,
        }),
        NOW,
      ),
    ).toBeUndefined();
  });

  it('does not forward arbitrary free-text campaign values', () => {
    expect(
      readConsentedPublicAttributionCookie(
        cookies({
          tl_analytics_consent: `1|accepted|${NOW}`,
          tl_public_attribution: `2|${NOW}|John%20Doe|private%20notes|Customer%20Alpha`,
        }),
        NOW,
      ),
    ).toBeUndefined();
  });
});
