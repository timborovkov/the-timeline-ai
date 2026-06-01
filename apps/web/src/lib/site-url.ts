import { nonEmptyEnv } from '@/lib/safe-redirect';

/**
 * Canonical site URL used by metadata, OG/Twitter image bases, robots,
 * and sitemap. Single source so we don't ship localhost references to
 * production by accident.
 *
 * Resolution order:
 *   1. `AUTH_URL` — the value we explicitly set in production.
 *   2. `VERCEL_URL` — auto-injected by Vercel for preview deploys
 *      (host only, no protocol). Prepend `https://`.
 *   3. `NEXTAUTH_URL` — legacy compatibility fallback.
 *   4. `http://localhost:3000` — local dev fallback.
 */
export function getSiteUrl(): string {
  const authUrl = nonEmptyEnv(process.env.AUTH_URL);
  if (authUrl) return authUrl;
  const vercelUrl = nonEmptyEnv(process.env.VERCEL_URL);
  if (vercelUrl) return `https://${vercelUrl}`;
  const nextAuthUrl = nonEmptyEnv(process.env.NEXTAUTH_URL);
  if (nextAuthUrl) return nextAuthUrl;
  return 'http://localhost:3000';
}
