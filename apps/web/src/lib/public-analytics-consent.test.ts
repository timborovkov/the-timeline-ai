import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  clearPublicAnalyticsConsent,
  getPublicAnalyticsConsentSnapshot,
  parsePublicAnalyticsConsent,
  PUBLIC_ANALYTICS_CONSENT_COOKIE,
  PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS,
  readPublicAnalyticsConsent,
  subscribePublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
// Test environment: happy-dom

afterEach(() => {
  clearPublicAnalyticsConsent();
});

describe('public analytics consent', () => {
  it('round-trips a versioned choice without adding a visitor identifier', () => {
    const now = Date.now();

    const written = writePublicAnalyticsConsent('accepted', now);

    expect(written).toEqual({ choice: 'accepted', timestamp: now, version: 2 });
    expect(readPublicAnalyticsConsent()).toEqual(written);
    expect(document.cookie).toContain(`${PUBLIC_ANALYTICS_CONSENT_COOKIE}=2|accepted|${now}`);
    expect(document.cookie).not.toMatch(/(?:user|team|visitor|session|device)[_-]?id/iu);
    expect(PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 180);
  });

  it('accepts only the current format and a plausible timestamp', () => {
    const now = 1_787_318_400_000;

    expect(parsePublicAnalyticsConsent(`2|rejected|${now}`, now)).toEqual({
      choice: 'rejected',
      timestamp: now,
      version: 2,
    });
    expect(parsePublicAnalyticsConsent(`1|accepted|${now}`, now)).toBeUndefined();
    expect(parsePublicAnalyticsConsent(`3|accepted|${now}`, now)).toBeUndefined();
    expect(
      parsePublicAnalyticsConsent(
        `2|accepted|${now - (PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS + 1) * 1_000}`,
        now,
      ),
    ).toBeUndefined();
    expect(
      parsePublicAnalyticsConsent(`2|accepted|${now + 5 * 60 * 1000 + 1}`, now),
    ).toBeUndefined();
    expect(parsePublicAnalyticsConsent('1|maybe|1787318400000', now)).toBeUndefined();
    expect(parsePublicAnalyticsConsent('not-a-choice', now)).toBeUndefined();
  });

  it('removes the stored choice when consent must be requested again', () => {
    writePublicAnalyticsConsent('rejected');
    expect(readPublicAnalyticsConsent()?.choice).toBe('rejected');

    clearPublicAnalyticsConsent();

    expect(readPublicAnalyticsConsent()).toBeUndefined();
  });

  it('publishes only current consent snapshots to subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePublicAnalyticsConsent(listener);
    const now = Date.now();

    writePublicAnalyticsConsent('accepted', now);

    expect(listener).toHaveBeenCalledOnce();
    expect(getPublicAnalyticsConsentSnapshot()).toBe(`2|accepted|${now}`);

    document.cookie = `${PUBLIC_ANALYTICS_CONSENT_COOKIE}=0|accepted|${now}; Path=/`;
    expect(getPublicAnalyticsConsentSnapshot()).toBeUndefined();

    clearPublicAnalyticsConsent();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
