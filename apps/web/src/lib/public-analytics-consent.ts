export const PUBLIC_ANALYTICS_CONSENT_COOKIE = 'tl_analytics_consent';
const PUBLIC_ANALYTICS_CONSENT_VERSION = 1;
export const PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export type PublicAnalyticsConsentChoice = 'accepted' | 'rejected';

export interface PublicAnalyticsConsentRecord {
  choice: PublicAnalyticsConsentChoice;
  timestamp: number;
  version: typeof PUBLIC_ANALYTICS_CONSENT_VERSION;
}

const CONSENT_VALUE = /^(\d+)\|(accepted|rejected)\|(\d{13})$/;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const consentSubscribers = new Set<() => void>();
let consentExpiryTimer: ReturnType<typeof setTimeout> | undefined;

export function parsePublicAnalyticsConsent(
  value: string | undefined,
  now = Date.now(),
): PublicAnalyticsConsentRecord | undefined {
  if (!value) return undefined;
  const match = CONSENT_VALUE.exec(value);
  if (!match) return undefined;

  const version = Number(match[1]);
  const timestamp = Number(match[3]);
  if (
    version !== PUBLIC_ANALYTICS_CONSENT_VERSION ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp > now + MAX_FUTURE_CLOCK_SKEW_MS ||
    now - timestamp > PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS * 1_000
  ) {
    return undefined;
  }

  return {
    choice: match[2] as PublicAnalyticsConsentChoice,
    timestamp,
    version: PUBLIC_ANALYTICS_CONSENT_VERSION,
  };
}

export function readPublicAnalyticsConsent(): PublicAnalyticsConsentRecord | undefined {
  return parsePublicAnalyticsConsent(getPublicAnalyticsConsentSnapshot());
}

export function getPublicAnalyticsConsentSnapshot(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = readDocumentCookie(PUBLIC_ANALYTICS_CONSENT_COOKIE);
  return parsePublicAnalyticsConsent(value) ? value : undefined;
}

export function subscribePublicAnalyticsConsent(listener: () => void): () => void {
  consentSubscribers.add(listener);
  scheduleConsentExpiry();
  return () => {
    consentSubscribers.delete(listener);
    scheduleConsentExpiry();
  };
}

export function writePublicAnalyticsConsent(
  choice: PublicAnalyticsConsentChoice,
  now = Date.now(),
): PublicAnalyticsConsentRecord {
  const record: PublicAnalyticsConsentRecord = {
    choice,
    timestamp: now,
    version: PUBLIC_ANALYTICS_CONSENT_VERSION,
  };
  if (typeof document !== 'undefined') {
    document.cookie = cookieAssignment(
      PUBLIC_ANALYTICS_CONSENT_COOKIE,
      `${record.version}|${record.choice}|${record.timestamp}`,
      PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS,
    );
    notifyConsentSubscribers();
  }
  return record;
}

export function clearPublicAnalyticsConsent(): void {
  expireFirstPartyCookie(PUBLIC_ANALYTICS_CONSENT_COOKIE);
  notifyConsentSubscribers();
}

export function expireFirstPartyCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = cookieAssignment(name, '', 0);
}

export function readDocumentCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return cookie.slice(prefix.length);
  }
  return undefined;
}

function cookieAssignment(name: string, value: string, maxAgeSeconds: number): string {
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  const expires = maxAgeSeconds === 0 ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : '';
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}${expires}; SameSite=Lax${secure}`;
}

function notifyConsentSubscribers(): void {
  scheduleConsentExpiry();
  for (const listener of consentSubscribers) listener();
}

function scheduleConsentExpiry(): void {
  if (consentExpiryTimer) {
    clearTimeout(consentExpiryTimer);
    consentExpiryTimer = undefined;
  }
  if (consentSubscribers.size === 0) return;

  const consent = readPublicAnalyticsConsent();
  if (!consent) return;
  const expiresAt = consent.timestamp + PUBLIC_ANALYTICS_CONSENT_MAX_AGE_SECONDS * 1_000;
  const delay = Math.min(Math.max(expiresAt - Date.now() + 1, 0), MAX_TIMER_DELAY_MS);
  consentExpiryTimer = setTimeout(notifyConsentSubscribers, delay);
}
