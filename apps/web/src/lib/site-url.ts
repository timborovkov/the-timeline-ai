import { nonEmptyEnv } from '@/lib/safe-redirect';

/** Origin baked into prerendered public HTML when Docker/Railway omit AUTH_URL. */
export const CANONICAL_PUBLIC_ORIGIN = 'https://thetimeline.cc';

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
 *   4. `https://thetimeline.cc` in production builds, otherwise
 *      `http://localhost:3000`.
 */
export function getSiteUrl(): string {
  const authUrl = nonEmptyEnv(process.env.AUTH_URL);
  if (authUrl) return canonicalOrigin(authUrl);
  const vercelUrl = nonEmptyEnv(process.env.VERCEL_URL);
  if (vercelUrl) return canonicalOrigin(`https://${vercelUrl}`);
  const nextAuthUrl = nonEmptyEnv(process.env.NEXTAUTH_URL);
  if (nextAuthUrl) return canonicalOrigin(nextAuthUrl);
  return process.env.NODE_ENV === 'production' ? CANONICAL_PUBLIC_ORIGIN : 'http://localhost:3000';
}

export function appUrl(path: string): URL {
  return new URL(path, `${getSiteUrl()}/`);
}

function canonicalOrigin(url: string): string {
  return new URL(url).origin;
}
