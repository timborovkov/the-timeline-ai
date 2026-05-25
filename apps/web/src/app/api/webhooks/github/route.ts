import { integrationSelections, integrations as integrationsTable } from '@timeline/db';
import { email, integrations as integrationsLib, queue, rateLimit } from '@timeline/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GitHub webhooks are signed with X-Hub-Signature-256 over the raw body.
// We resolve the tenant from the payload (repository.full_name → integration
// selection, then installation/org/owner/sender id → external_account_id)
// before fanning out, so a webhook for tenant A can't write rows into tenant
// B's raw_events.

function extractGithubTenantIds(payload: unknown): {
  repoFullNames: string[];
  externalAccountIds: string[];
} {
  const repos = new Set<string>();
  const accounts = new Set<string>();
  if (!payload || typeof payload !== 'object') return { repoFullNames: [], externalAccountIds: [] };
  const p = payload as Record<string, unknown>;
  const repo = p.repository as Record<string, unknown> | undefined;
  if (repo && typeof repo.full_name === 'string') repos.add(repo.full_name);
  const repoOwner = repo?.owner as Record<string, unknown> | undefined;
  if (repoOwner && typeof repoOwner.id === 'number') accounts.add(String(repoOwner.id));
  const org = p.organization as Record<string, unknown> | undefined;
  if (org && typeof org.id === 'number') accounts.add(String(org.id));
  const inst = p.installation as Record<string, unknown> | undefined;
  if (inst && typeof inst.id === 'number') accounts.add(String(inst.id));
  const sender = p.sender as Record<string, unknown> | undefined;
  if (sender && typeof sender.id === 'number') accounts.add(String(sender.id));
  return { repoFullNames: Array.from(repos), externalAccountIds: Array.from(accounts) };
}

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
  // Resolve the originating tenant(s) from the payload before fanning out.
  // Match an integration when EITHER (a) one of its selections references the
  // exact repo full_name, or (b) its external_account_id matches one of the
  // user/org/installation ids on the payload. Replay is still safe — the
  // dedup_key partial unique index makes duplicate writes a no-op.
  const { repoFullNames, externalAccountIds } = extractGithubTenantIds(payload);
  if (repoFullNames.length === 0 && externalAccountIds.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_tenant_ids' }, { status: 200 });
  }
  const integrationIdsByRepo =
    repoFullNames.length > 0
      ? (
          await db
            .select({ integrationId: integrationSelections.integrationId })
            .from(integrationSelections)
            .where(
              and(
                eq(integrationSelections.selectionKind, 'github.repo'),
                inArray(integrationSelections.externalId, repoFullNames),
              ),
            )
        ).map((r) => r.integrationId)
      : [];
  const matchClauses = [];
  if (integrationIdsByRepo.length > 0) {
    matchClauses.push(inArray(integrationsTable.id, integrationIdsByRepo));
  }
  if (externalAccountIds.length > 0) {
    matchClauses.push(inArray(integrationsTable.externalAccountId, externalAccountIds));
  }
  if (matchClauses.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_matching_tenant' }, { status: 200 });
  }
  const tenantClause =
    matchClauses.length === 1 ? matchClauses[0] : or(...matchClauses);
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'github'),
        eq(integrationsTable.enabled, true),
        tenantClause,
      ),
    );
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_matching_tenant' }, { status: 200 });
  }
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
