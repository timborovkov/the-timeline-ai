/**
 * Compute up-to-two-letter initials for an avatar monogram.
 *
 * Single source of truth for [team-switcher.tsx](../components/team-switcher.tsx)
 * and [timeline-list.tsx](../components/timeline-list.tsx) so the two surfaces
 * can't drift on edge cases.
 *
 * Handles three real-world inputs we render avatars for:
 *   1. Plain names: "Tim Borovkov" → "TB"
 *   2. Single-word names: "System" / "Acme" → "S" / "A"
 *   3. Email-tagged labels: "Tim <tim@x.com>" → "T" (the address suffix is
 *      stripped first so we monogram on the human name, not the URL)
 *   4. Bare emails: "tim@x.com" → "T" (local part initial)
 *
 * Returns "?" for empty / whitespace input so the avatar slot is never blank.
 */
export function initials(label: string): string {
  // Strip a trailing "<email>" so we monogram on the name (or local-part).
  const stripped = label.replace(/\s*<[^>]*>\s*$/, '').trim();
  const base = stripped.length > 0 ? stripped : label.trim();
  if (base.length === 0) return '?';
  const parts = base.split(/\s+/).slice(0, 2);
  const out = parts
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .trim();
  return out || '?';
}
