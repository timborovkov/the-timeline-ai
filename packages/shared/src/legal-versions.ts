/**
 * Current public legal-document versions.
 *
 * Keep these values as the single source consumed by the web legal gate and
 * every fixture that snapshots accepted versions.
 */
export const TERMS_VERSION = '2026-11-03';
export const PRIVACY_VERSION = '2026-11-03';
export const PRIVACY_EFFECTIVE_DATE = 'November 3, 2026';
export const LEGAL_EFFECTIVE_DATE = 'November 3, 2026';

/**
 * Pre-launch Privacy acknowledgments that remain valid without a renewed
 * acceptance. The 2026-11-03 disclosure edits keep Privacy `2026-11-01`
 * current for existing users.
 */
const GRANDFATHERED_PRIVACY_VERSIONS: readonly string[] = ['2026-11-01'];

export function isCurrentPrivacyVersion(version: string | null | undefined): boolean {
  return (
    version === PRIVACY_VERSION ||
    (typeof version === 'string' && GRANDFATHERED_PRIVACY_VERSIONS.includes(version))
  );
}
