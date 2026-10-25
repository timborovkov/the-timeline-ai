import { forwardSentryTunnelEnvelope } from '@/lib/sentry-tunnel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Browser Sentry envelopes. Implemented as an App Router handler rather than
 * `withSentryConfig({ tunnelRoute })` so Next.js does not rewrite the POST
 * through `proxyRequest` (the path that stacks 11 `close` listeners on the
 * Node `ServerResponse`).
 */
export async function POST(req: Request): Promise<Response> {
  return forwardSentryTunnelEnvelope({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    req,
  });
}
