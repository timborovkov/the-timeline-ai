import { integrationSelections, integrations as integrationsTable } from '@timeline/db';
import * as email from '@timeline/shared/email';
import * as integrationsLib from '@timeline/shared/integrations';
import * as rateLimit from '@timeline/shared/rate-limit';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { reportCaughtError } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GitHub webhooks are signed with X-Hub-Signature-256 over the raw body.
// We resolve the destination integration(s) from the payload by matching
// repository.full_name against `integration_selections.external_id`
// (kind=github.repo). Only integrations that have ADDED the repo to
// their selections get events written, so a webhook for tenant A's
// unselected repo can't write rows into tenant B's raw_events.

function extractGithubTenantIds(payload: unknown): { repoFullNames: string[] } {
  const repos = new Set<string>();
  if (!payload || typeof payload !== 'object') return { repoFullNames: [] };
  const p = payload as Record<string, unknown>;
  const repo = p.repository as Record<string, unknown> | undefined;
  if (repo && typeof repo.full_name === 'string') repos.add(repo.full_name);
  return { repoFullNames: Array.from(repos) };
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
  // Resolve which integrations actually care about this payload's repo.
  // A team must have ADDED the repo to its github.repo selections — an
  // account-id match alone isn't enough. Bugbot caught the original
  // shape: if a team OAuthed as user X and X has 50 repos in their
  // org, webhooks for ALL 50 would write events even though the team
  // only selected one. Restrict to selection-matched integrations.
  const { repoFullNames } = extractGithubTenantIds(payload);
  if (repoFullNames.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_repo_in_payload' }, { status: 200 });
  }
  // Tenant isolation is enforced at PUT-time on
  // /api/integrations/manage/[id]/selections, where every proposed
  // `external_id` is validated against `listSyncableResources` (the
  // integration's actual OAuth scope). A team that doesn't have access
  // to `tenantA/private-repo` cannot save it as a selection, so
  // matching on selection alone is safe here. Cross-checking
  // `external_account_id` against payload account ids would break
  // org-owned repos (we store the OAuthing user's id, payloads carry
  // the org/installation id).
  const selectionMatched = await db
    .select({ integrationId: integrationSelections.integrationId })
    .from(integrationSelections)
    .where(
      and(
        eq(integrationSelections.selectionKind, 'github.repo'),
        inArray(integrationSelections.externalId, repoFullNames),
      ),
    );
  const matchedIntegrationIds = Array.from(new Set(selectionMatched.map((r) => r.integrationId)));
  if (matchedIntegrationIds.length === 0) {
    return NextResponse.json({ ok: true, reason: 'no_matching_selection' }, { status: 200 });
  }
  const rows = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.provider, 'github'),
        eq(integrationsTable.enabled, true),
        inArray(integrationsTable.id, matchedIntegrationIds),
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
    } catch (err) {
      // continue — one broken integration doesn't fail the whole webhook
      reportCaughtError(err, {
        surface: 'background',
        operation: 'github_webhook_write_events',
        tags: { provider: 'github' },
      });
    }
  }
  // Side benefit: kick an incremental sync so any missed events get
  // back-filled from the cursor. incrementalSync internally walks the
  // selections, so this is safe — unselected repos won't generate events.
  for (const integration of rows) {
    try {
      const queue = await requireRedisQueue();
      await queue.enqueueIntegrationSyncJob({
        kind: 'incremental',
        integrationId: integration.id,
        teamId: integration.teamId,
        triggeredBy: 'webhook',
      });
    } catch (err) {
      // ignore
      reportCaughtError(err, {
        surface: 'background',
        operation: 'github_webhook_enqueue_sync',
        tags: { provider: 'github' },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
