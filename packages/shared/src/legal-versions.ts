/**
 * Current public legal-document versions.
 *
 * Keep these values as the single source consumed by the web legal gate and
 * every fixture that snapshots accepted versions. Use YYYY-MM-DD, with an optional
 * positive .N revision for a further material update on the same day.
 */
export const TERMS_VERSION = '2026-11-24';
export const PRIVACY_VERSION = '2026-11-14.1';
export const PRIVACY_EFFECTIVE_DATE = 'November 14, 2026';
export const LEGAL_EFFECTIVE_DATE = 'November 24, 2026';

/** Optional evaluation processing requires renewed privacy acknowledgment. */
export function isCurrentPrivacyVersion(version: string | null | undefined): boolean {
  return version === PRIVACY_VERSION;
}
