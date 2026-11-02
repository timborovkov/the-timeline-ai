import { getEnv } from '@timeline/shared/env';

import { getSupportEmail } from '@/lib/support-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** Request-time public config for statically prerendered pages. */
export function GET(): Response {
  const env = getEnv();
  return Response.json(
    {
      supportEmail: getSupportEmail(),
      turnstileSiteKey: nonEmpty(env.TURNSTILE_SITE_KEY),
      requiresTurnstile: process.env.NODE_ENV === 'production',
      taskCategoriesEnabled: env.TASK_CATEGORY_UI_ENABLED,
      publicPostHogKey: nonEmpty(env.NEXT_PUBLIC_POSTHOG_KEY),
      publicPostHogHost: nonEmpty(env.NEXT_PUBLIC_POSTHOG_HOST),
    },
    {
      headers: { 'cache-control': 'no-store' },
    },
  );
}
