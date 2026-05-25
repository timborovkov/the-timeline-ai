import { integrations as integrationsTable } from '@timeline/db';
import { email, queue, rateLimit } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Google Drive push notifications arrive as POST with empty body and a
// set of `x-goog-*` headers identifying the channel + resource. Drive
// uses channel tokens — set via channels.watch — that we verify against
// a per-integration token. For the initial release we accept the
// notification, lookup the integration by `x-goog-channel-token`, and
// enqueue an incremental sync; full body verification can be tightened
// once we wire channel registration into the OAuth callback.

export async function POST(req: Request): Promise<Response> {
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'drive_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }
  const channelToken = req.headers.get('x-goog-channel-token') ?? '';
  if (!channelToken) {
    return NextResponse.json({ ok: false, reason: 'missing_token' }, { status: 200 });
  }
  // We currently key on the integration id directly when registering
  // watches (channel_token = integration id). Look up that row and
  // enqueue. Unknown tokens are silently ignored to avoid Drive's
  // aggressive retry behavior pinging us forever.
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'google_drive'),
        eq(integrationsTable.id, channelToken),
        eq(integrationsTable.enabled, true),
      ),
    )
    .limit(1);
  const integration = rows[0];
  if (!integration) {
    return NextResponse.json({ ok: true });
  }
  await queue.enqueueIntegrationSyncJob({
    kind: 'incremental',
    integrationId: integration.id,
    teamId: integration.teamId,
    triggeredBy: 'webhook',
  });
  return NextResponse.json({ ok: true });
}
