import { integrations as integrationsTable } from '@timeline/db';
import { email, integrations as integrationsLib, queue, rateLimit } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Linear webhooks are signed with `Linear-Signature` over the raw body
// using LINEAR_WEBHOOK_SECRET. Same fanout pattern as GitHub.

export async function POST(req: Request): Promise<Response> {
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('integration', 'linear_ip', clientIp),
      ...rateLimit.RATE_LIMITS.integrationWebhook,
    });
    if (!rl.ok) {
      return NextResponse.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
  }
  const sig = req.headers.get('linear-signature');
  const body = await req.text();
  if (!integrationsLib.verifyLinearSignature(body, sig)) {
    return NextResponse.json({ ok: false, reason: 'bad_signature' }, { status: 200 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 200 });
  }
  // Linear webhooks carry `organizationId` at the top level. We OAuth as
  // an organization (externalAccountId == LinearOrg.id), so isolating by
  // that id ensures org A's webhook can't write to org B's tenant.
  const orgIdRaw =
    payload && typeof payload === 'object' && 'organizationId' in payload
      ? (payload as { organizationId?: unknown }).organizationId
      : undefined;
  const orgId = typeof orgIdRaw === 'string' ? orgIdRaw : '';
  if (!orgId) {
    return NextResponse.json({ ok: true, reason: 'no_org_id' }, { status: 200 });
  }
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'linear'),
        eq(integrationsTable.enabled, true),
        eq(integrationsTable.externalAccountId, orgId),
      ),
    );
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_matching_tenant' }, { status: 200 });
  }
  for (const integration of rows) {
    try {
      const provider = integrationsLib.getProvider('linear');
      const events = (await provider.handleWebhook?.({ integration, payload })) ?? [];
      if (events.length > 0) {
        await integrationsLib.writeIntegrationEvents({ db, integration, events });
      }
      await queue.enqueueIntegrationSyncJob({
        kind: 'incremental',
        integrationId: integration.id,
        teamId: integration.teamId,
        triggeredBy: 'webhook',
      });
    } catch {
      // continue
    }
  }
  return NextResponse.json({ ok: true });
}
