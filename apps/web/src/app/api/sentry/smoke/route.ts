import * as Sentry from '@sentry/nextjs';

import { reportCaughtError } from '@/lib/sentry-report';

export const dynamic = 'force-dynamic';

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

export async function POST(request: Request): Promise<Response> {
  const token = process.env.SENTRY_SMOKE_TEST_TOKEN;
  if (!token) {
    return Response.json({ ok: false, reason: 'disabled' }, { status: 404 });
  }

  if (bearerToken(request) !== token) {
    return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const sentryConfigured = Boolean(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!sentryConfigured) {
    return Response.json({ ok: false, sentryConfigured }, { status: 503 });
  }

  const clientInitialized = Boolean(Sentry.getClient());
  if (!clientInitialized) {
    return Response.json({ ok: false, sentryConfigured, clientInitialized }, { status: 503 });
  }

  reportCaughtError(new Error('sentry_smoke_test'), {
    surface: 'api',
    operation: 'sentry_smoke_test',
    tags: { component: 'web' },
  });

  const flushed = await Sentry.flush(2000);
  return Response.json({ ok: true, sentryConfigured, clientInitialized, flushed });
}
