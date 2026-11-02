import { getEnv } from '@timeline/shared/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public Turnstile site key for statically prerendered anonymous forms. */
export function GET(): Response {
  const siteKey = getEnv().TURNSTILE_SITE_KEY?.trim();
  return Response.json(
    { siteKey: siteKey && siteKey.length > 0 ? siteKey : null },
    {
      headers: { 'cache-control': 'no-store' },
    },
  );
}
