/**
 * Canonical site URL used by metadata, OG/Twitter image bases, robots,
 * and sitemap. Single source so we don't ship localhost references to
 * production by accident.
 *
 * Resolution order:
 *   1. `AUTH_URL` / `NEXTAUTH_URL` — the value we explicitly set in prod.
 *   2. `VERCEL_URL` — auto-injected by Vercel for preview deploys
 *      (host only, no protocol). Prepend `https://`.
 *   3. `http://localhost:3000` — local dev fallback.
 */
export function getSiteUrl(): string {
  if (process.env.AUTH_URL) return process.env.AUTH_URL;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
