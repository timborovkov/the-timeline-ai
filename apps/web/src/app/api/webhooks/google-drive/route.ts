import { createHmac, timingSafeEqual } from 'node:crypto';

import { integrations as integrationsTable } from '@timeline/db';
import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import * as rateLimit from '@timeline/shared/rate-limit';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { reportCaughtError, reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Google Drive push notifications arrive as POST with empty body and a
// set of `x-goog-*` headers identifying the channel + resource. The
// channel token must be `<integration_id>.<HMAC-SHA256(secret, id)>`
// so a leaked or guessed UUID alone isn't enough to trigger a sync. The
// drive watch-registration code (out of scope for this webhook handler)
// mints the token the same way.

function verifyChannelToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [integrationId, sig] = parts;
  if (!integrationId || !sig) return null;
  const expected = createHmac('sha256', secret).update(integrationId).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return integrationId;
}

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
    reportHandledEvent({
      message: 'google_drive_webhook_missing_token',
      surface: 'api',
      operation: 'google_drive_webhook_auth',
      level: 'warning',
      tags: { provider: 'google_drive', reason: 'missing_token' },
    });
    return NextResponse.json({ ok: false, reason: 'missing_token' }, { status: 200 });
  }
  const env = getEnv();
  const secret = env.GOOGLE_DRIVE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — refuse the webhook entirely rather than
    // accept guessable plain-UUID tokens. Drive will keep retrying for
    // a while but stops eventually; the watch will need re-registration
    // once the secret is set.
    reportHandledEvent({
      message: 'google_drive_webhook_secret_unconfigured',
      surface: 'api',
      operation: 'google_drive_webhook_auth',
      level: 'warning',
      tags: { provider: 'google_drive', reason: 'webhook_secret_unconfigured' },
    });
    return NextResponse.json({ ok: false, reason: 'webhook_secret_unconfigured' }, { status: 200 });
  }
  const integrationId = verifyChannelToken(channelToken, secret);
  if (!integrationId) {
    reportHandledEvent({
      message: 'google_drive_webhook_bad_signature',
      surface: 'api',
      operation: 'google_drive_webhook_auth',
      level: 'warning',
      tags: { provider: 'google_drive', reason: 'bad_signature' },
    });
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 200 });
  }
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'google_drive'),
        eq(integrationsTable.id, integrationId),
        eq(integrationsTable.enabled, true),
      ),
    )
    .limit(1);
  const integration = rows[0];
  if (!integration) {
    return NextResponse.json({ ok: true });
  }
  try {
    const queue = await requireRedisQueue();
    await queue.enqueueIntegrationSyncJob({
      kind: 'incremental',
      integrationId: integration.id,
      teamId: integration.teamId,
      triggeredBy: 'webhook',
    });
  } catch (err) {
    reportCaughtError(err, {
      surface: 'background',
      operation: 'google_drive_webhook_enqueue_sync',
      tags: { provider: 'google_drive' },
    });
    return NextResponse.json({ ok: true, reason: 'enqueue_failed' }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
