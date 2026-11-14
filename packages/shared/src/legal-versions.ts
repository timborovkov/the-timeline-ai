/**
 * Current public legal-document versions.
 *
 * Keep these values as the single source consumed by the web legal gate and
 * every fixture that snapshots accepted versions.
 */
export const TERMS_VERSION = '2026-11-11';
export const PRIVACY_VERSION = '2026-11-14';
export const PRIVACY_EFFECTIVE_DATE = 'November 14, 2026';
export const LEGAL_EFFECTIVE_DATE = 'November 11, 2026';

/** Optional conversation-report processing requires renewed privacy acknowledgment. */
export function isCurrentPrivacyVersion(version: string | null | undefined): boolean {
  return version === PRIVACY_VERSION;
}
