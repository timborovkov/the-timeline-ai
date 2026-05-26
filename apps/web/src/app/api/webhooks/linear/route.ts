import { integrationSelections, integrations as integrationsTable } from '@timeline/db';
import { email, integrations as integrationsLib, queue, rateLimit } from '@timeline/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

// Pull the Linear team id out of a webhook payload. The schema varies by
// entity type — Linear puts it at different paths for Issue vs Comment
// vs Project. Returns null when no team id can be resolved (we treat
// that as "can't filter; drop conservatively" against selections).
function extractLinearTeamId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;
  // Top-level teamId on the webhook envelope (Issue, Project).
  if (typeof data.teamId === 'string') return data.teamId;
  // Nested team object (some entity types).
  const team = data.team as Record<string, unknown> | undefined;
  if (team && typeof team.id === 'string') return team.id;
  // Comment payloads carry the issue object with a teamId/team.
  const issue = data.issue as Record<string, unknown> | undefined;
  if (issue) {
    if (typeof issue.teamId === 'string') return issue.teamId;
    const issueTeam = issue.team as Record<string, unknown> | undefined;
    if (issueTeam && typeof issueTeam.id === 'string') return issueTeam.id;
  }
  return null;
}

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
  // Phase 11 — respect linear.team selections. The scheduled sync only
  // pulls data for selected teams; the webhook should match. Pull the
  // payload's team id once, then filter each integration's selections
  // against it. An integration with no linear.team selections drops
  // the event (same strict posture as github.repo).
  const payloadTeamId = extractLinearTeamId(payload);
  const selectionRows = await db
    .select({
      integrationId: integrationSelections.integrationId,
      externalId: integrationSelections.externalId,
    })
    .from(integrationSelections)
    .where(
      and(
        eq(integrationSelections.selectionKind, 'linear.team'),
        inArray(
          integrationSelections.integrationId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const teamsByIntegration = new Map<string, Set<string>>();
  for (const r of selectionRows) {
    let set = teamsByIntegration.get(r.integrationId);
    if (!set) {
      set = new Set();
      teamsByIntegration.set(r.integrationId, set);
    }
    set.add(r.externalId);
  }
  for (const integration of rows) {
    try {
      const selectedTeams = teamsByIntegration.get(integration.id);
      const matches =
        // If selections exist for this integration: payload team id must
        // be present AND must be one of the selected teams. If we can't
        // resolve a team id from the payload, drop (conservative).
        selectedTeams && selectedTeams.size > 0
          ? payloadTeamId !== null && selectedTeams.has(payloadTeamId)
          : // No selections recorded: drop everything for this integration,
            // matching github.repo's "explicit opt-in required" posture.
            false;
      if (!matches) {
        continue;
      }
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
