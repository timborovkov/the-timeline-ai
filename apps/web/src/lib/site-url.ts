import { nonEmptyEnv } from '@/lib/safe-redirect';

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
  const authUrl = nonEmptyEnv(process.env.AUTH_URL) ?? nonEmptyEnv(process.env.NEXTAUTH_URL);
  if (authUrl) return authUrl;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
