import { integrations as integrationsTable } from '@timeline/db';
import { email, integrations as integrationsLib, queue, rateLimit } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GitHub webhooks are signed with X-Hub-Signature-256 over the raw body.
// We fan out to every team-integration whose provider is github since the
// webhook itself is org-/repo-scoped and we don't have a 1:1 binding.

export async function POST(req: Request): Promise<Response> {
  // Per-IP rate gate in front of HMAC verify + DB lookup so a
  // bogus-payload flood can't burn capacity. Always return 200 so the
  // sender doesn't retry-storm.
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'github_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }
  const sig = req.headers.get('x-hub-signature-256');
  const body = await req.text();
  if (!integrationsLib.verifyGithubSignature(body, sig)) {
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 200 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }
  // Look up every github integration and ask the provider adapter to
  // normalize. Replay is safe — the dedup_key partial unique index
  // makes duplicate writes a no-op.
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(and(eq(integrationsTable.provider, 'github'), eq(integrationsTable.enabled, true)));
  for (const integration of rows) {
    try {
      const provider = integrationsLib.getProvider('github');
      const events = (await provider.handleWebhook?.({ integration, payload })) ?? [];
      if (events.length > 0) {
        await integrationsLib.writeIntegrationEvents({ db, integration, events });
      }
    } catch {
      // continue — one broken integration doesn't fail the whole webhook
    }
  }
  // Side benefit: kick an incremental sync so any missed events get
  // back-filled from the cursor.
  for (const integration of rows) {
    try {
      await queue.enqueueIntegrationSyncJob({
        kind: 'incremental',
        integrationId: integration.id,
        teamId: integration.teamId,
        triggeredBy: 'webhook',
      });
    } catch {
      // ignore
    }
  }
  return NextResponse.json({ ok: true });
}
