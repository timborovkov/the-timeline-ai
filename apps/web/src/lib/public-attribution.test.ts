// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
import {
  clearPublicAttributionCookie,
  parsePublicAttributionCookie,
  PUBLIC_ATTRIBUTION_COOKIE,
  PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS,
  publicAttributionFromSearchParams,
  readPublicAttributionCookie,
  storeFirstTouchPublicAttribution,
} from '@/lib/public-attribution';

afterEach(() => {
  clearPublicAttributionCookie();
  clearPublicAnalyticsConsent();
  window.history.replaceState({}, '', '/');
});

describe('public campaign attribution', () => {
  const firstTouchedAt = Date.UTC(2026, 7, 21, 12);

  it('keeps only bounded reviewed UTM dimensions', () => {
    const params = new URLSearchParams(
      'utm_source=GitHub&utm_medium=paid+social&utm_campaign=Launch' +
        '&gclid=secret-click-id&fbclid=another-click-id&email=person%40example.com',
    );

    expect(publicAttributionFromSearchParams(params)).toEqual({
      source: 'github',
      medium: 'paid_social',
      campaign: 'launch',
    });
    expect(
      publicAttributionFromSearchParams(
        new URLSearchParams(`utm_source=${'a'.repeat(81)}&utm_medium=%2Fprivate%2Fpath`),
      ),
    ).toBeUndefined();
  });

  it('never retains unknown free text or PII-like campaign values', () => {
    const attribution = publicAttributionFromSearchParams(
      new URLSearchParams(
        'utm_source=John+Smith&utm_medium=private+notes&utm_campaign=Customer+Alpha',
      ),
    );

    expect(attribution).toBeUndefined();
    expect(
      publicAttributionFromSearchParams(
        new URLSearchParams('utm_source=person%40example.com&utm_campaign=%2Fprivate%2Fpath'),
      ),
    ).toBeUndefined();
  });

  it('stores first touch for 30 days and never overwrites it', () => {
    writePublicAnalyticsConsent('accepted');
    const first = storeFirstTouchPublicAttribution(
      '?utm_source=github&utm_medium=referral&utm_campaign=launch',
      firstTouchedAt,
    );
    const firstCookie = readCookie(PUBLIC_ATTRIBUTION_COOKIE);
    const second = storeFirstTouchPublicAttribution(
      '?utm_source=newsletter&utm_medium=email&utm_campaign=other',
      firstTouchedAt + 20 * 24 * 60 * 60 * 1_000,
    );

    expect(first).toEqual({ source: 'github', medium: 'referral', campaign: 'launch' });
    expect(second).toEqual(first);
    expect(readCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBe(firstCookie);
    expect(firstCookie).toBe(`2|${firstTouchedAt}|github|referral|launch`);
    expect(parsePublicAttributionCookie(firstCookie, firstTouchedAt)).toEqual(first);
    expect(PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });

  it('expires first touch after 30 days instead of sliding the window', () => {
    writePublicAnalyticsConsent('accepted');
    storeFirstTouchPublicAttribution('?utm_source=github', firstTouchedAt);
    const stored = readCookie(PUBLIC_ATTRIBUTION_COOKIE);

    expect(
      parsePublicAttributionCookie(
        stored,
        firstTouchedAt + PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS * 1_000,
      ),
    ).toEqual({ source: 'github', medium: undefined, campaign: undefined });
    expect(
      parsePublicAttributionCookie(
        stored,
        firstTouchedAt + PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS * 1_000 + 1,
      ),
    ).toBeUndefined();

    const replacement = storeFirstTouchPublicAttribution(
      '?utm_source=newsletter',
      firstTouchedAt + PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS * 1_000 + 1,
    );
    expect(replacement).toEqual({
      source: 'newsletter',
      medium: undefined,
      campaign: undefined,
    });
    expect(readCookie(PUBLIC_ATTRIBUTION_COOKIE)).not.toBe(stored);
  });

  it('stores nothing without affirmative consent or on an excluded route', () => {
    expect(storeFirstTouchPublicAttribution('?utm_source=github')).toBeUndefined();

    writePublicAnalyticsConsent('accepted');
    window.history.replaceState({}, '', '/help/support?utm_source=github');

    expect(storeFirstTouchPublicAttribution(window.location.search)).toBeUndefined();
    expect(readCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBeUndefined();
  });

  it('parses the same strict format from a server cookie reader', () => {
    const cookies = {
      get: (name: string) =>
        name === PUBLIC_ATTRIBUTION_COOKIE
          ? { value: `2|${firstTouchedAt}|github|paid_social|launch` }
          : undefined,
    };

    expect(readPublicAttributionCookie(cookies, firstTouchedAt)).toEqual({
      source: 'github',
      medium: 'paid_social',
      campaign: 'launch',
    });
    expect(
      parsePublicAttributionCookie(`2|${firstTouchedAt}|valid|%E0%A4%A|campaign`, firstTouchedAt),
    ).toBeUndefined();
    expect(parsePublicAttributionCookie(`1|github|paid|launch`, firstTouchedAt)).toBeUndefined();
    expect(
      parsePublicAttributionCookie(
        `2|${firstTouchedAt}|John%20Doe|private%20notes|private%20project`,
        firstTouchedAt,
      ),
    ).toBeUndefined();
  });
});

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}
