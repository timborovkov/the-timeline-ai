import {
  PUBLIC_ATTRIBUTION_CAMPAIGNS,
  PUBLIC_ATTRIBUTION_MEDIA,
  PUBLIC_ATTRIBUTION_SOURCES,
  type PublicAttributionCampaign,
  type PublicAttributionMedium,
  type PublicAttributionSource,
} from '@timeline/shared/analytics';

import {
  expireFirstPartyCookie,
  readDocumentCookie,
  readPublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
import { classifyPublicAnalyticsPath } from '@/lib/public-analytics-routes';

export const PUBLIC_ATTRIBUTION_COOKIE = 'tl_public_attribution';
export const PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface PublicAttribution {
  source?: PublicAttributionSource;
  medium?: PublicAttributionMedium;
  campaign?: PublicAttributionCampaign;
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

const ATTRIBUTION_VERSION = '2';
const ATTRIBUTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._~+ -]{0,79}$/;
const ATTRIBUTION_TIMESTAMP = /^\d{13}$/;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SOURCE_ALIASES = {
  'product hunt': 'product_hunt',
  'product-hunt': 'product_hunt',
  twitter: 'x',
} as const;
const MEDIUM_ALIASES = { 'paid social': 'paid_social', 'paid-social': 'paid_social' } as const;

export function publicAttributionFromSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>,
): PublicAttribution | undefined {
  return normalizePublicAttribution({
    source: searchParams.get('utm_source') ?? undefined,
    medium: searchParams.get('utm_medium') ?? undefined,
    campaign: searchParams.get('utm_campaign') ?? undefined,
  });
}

export function parsePublicAttributionCookie(
  value: string | undefined,
  now = Date.now(),
): PublicAttribution | undefined {
  if (!value) return undefined;
  const parts = value.split('|');
  if (parts.length !== 5 || parts[0] !== ATTRIBUTION_VERSION) return undefined;
  const [, capturedAtPart, sourcePart, mediumPart, campaignPart] = parts;
  if (
    !capturedAtPart ||
    !ATTRIBUTION_TIMESTAMP.test(capturedAtPart) ||
    sourcePart === undefined ||
    mediumPart === undefined ||
    campaignPart === undefined
  ) {
    return undefined;
  }
  const capturedAt = Number(capturedAtPart);
  if (
    !Number.isSafeInteger(capturedAt) ||
    capturedAt <= 0 ||
    capturedAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
    now - capturedAt > PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS * 1_000
  ) {
    return undefined;
  }

  try {
    return normalizePublicAttribution({
      source: decodePart(sourcePart),
      medium: decodePart(mediumPart),
      campaign: decodePart(campaignPart),
    });
  } catch {
    return undefined;
  }
}

export function readPublicAttributionCookie(
  cookies: CookieReader,
  now = Date.now(),
): PublicAttribution | undefined {
  return parsePublicAttributionCookie(cookies.get(PUBLIC_ATTRIBUTION_COOKIE)?.value, now);
}

export function storeFirstTouchPublicAttribution(
  search: string,
  now = Date.now(),
): PublicAttribution | undefined {
  if (typeof document === 'undefined') return undefined;
  if (
    readPublicAnalyticsConsent()?.choice !== 'accepted' ||
    !classifyPublicAnalyticsPath(window.location.pathname)
  ) {
    return undefined;
  }

  const storedValue = readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE);
  const existing = parsePublicAttributionCookie(storedValue, now);
  if (existing) return existing;
  if (storedValue) clearPublicAttributionCookie();

  const attribution = publicAttributionFromSearchParams(new URLSearchParams(search));
  if (!attribution) return undefined;

  writePublicAttributionCookie(attribution, now);
  return attribution;
}

export function clearPublicAttributionCookie(): void {
  expireFirstPartyCookie(PUBLIC_ATTRIBUTION_COOKIE);
}

function normalizePublicAttribution(
  input: Readonly<Record<keyof PublicAttribution, string | undefined>>,
): PublicAttribution | undefined {
  const source = canonicalAttributionValue(
    input.source,
    PUBLIC_ATTRIBUTION_SOURCES,
    SOURCE_ALIASES,
  );
  const medium = canonicalAttributionValue(input.medium, PUBLIC_ATTRIBUTION_MEDIA, MEDIUM_ALIASES);
  const campaign = canonicalAttributionValue(input.campaign, PUBLIC_ATTRIBUTION_CAMPAIGNS);
  if (!source && !medium && !campaign) return undefined;
  return {
    source,
    medium,
    campaign,
  };
}

function canonicalAttributionValue<T extends string>(
  value: string | undefined,
  values: readonly T[],
  aliases: Readonly<Record<string, T>> = {},
): T | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!ATTRIBUTION_VALUE.test(normalized)) return undefined;
  const alias = aliases[normalized];
  if (alias) return alias;
  return values.includes(normalized as T) ? (normalized as T) : undefined;
}

function writePublicAttributionCookie(attribution: PublicAttribution, capturedAt: number): void {
  const value = [
    ATTRIBUTION_VERSION,
    String(capturedAt),
    encodePart(attribution.source),
    encodePart(attribution.medium),
    encodePart(attribution.campaign),
  ].join('|');
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PUBLIC_ATTRIBUTION_COOKIE}=${value}; Path=/; Max-Age=${PUBLIC_ATTRIBUTION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function encodePart(value: string | undefined): string {
  return value ? encodeURIComponent(value) : '';
}

function decodePart(value: string): string | undefined {
  return value ? decodeURIComponent(value) : undefined;
}
