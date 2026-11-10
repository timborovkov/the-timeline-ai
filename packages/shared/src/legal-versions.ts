/**
 * Current public legal-document versions.
 *
 * Keep these values as the single source consumed by the web legal gate and
 * every fixture that snapshots accepted versions.
 */
export const TERMS_VERSION = '2026-11-10';
export const PRIVACY_VERSION = '2026-11-10';
export const PRIVACY_EFFECTIVE_DATE = 'November 10, 2026';
export const LEGAL_EFFECTIVE_DATE = 'November 10, 2026';

/** The corrected deletion disclosures require renewed acknowledgment. */
export function isCurrentPrivacyVersion(version: string | null | undefined): boolean {
  return version === PRIVACY_VERSION;
}
