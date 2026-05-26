import { integrations as integrationsLib, withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const selectionsSchema = z.object({
  selections: z.array(
    z.object({
      kind: z.string().min(1).max(64),
      externalId: z.string().min(1).max(256),
      label: z.string().max(256).optional().nullable(),
    }),
  ),
});

async function resolveScope(userId: string) {
  const { active } = await resolveActiveTeam(userId);
  if (!active) return null;
  return { scope: withTeam(db, active.teamId, userId), active };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const resolved = await resolveScope(session.user.id);
  if (!resolved) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const { scope } = resolved;
  // Listing syncable resources decrypts team OAuth tokens and calls the
  // provider API on the integration's behalf. PUT requires admin to change
  // selections; GET must require admin too so a non-admin member can't
  // enumerate every external repo/project/folder the team's tokens can
  // reach.
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const integration = await scope.integrations.getIntegration(id);
  if (!integration) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const [tokens, selections] = await Promise.all([
    scope.integrations.getIntegrationTokens(id),
    scope.integrations.listSelections(id),
  ]);
  if (!tokens) {
    return NextResponse.json({ resources: [], selections });
  }
  try {
    const provider = integrationsLib.getProvider(integration.provider);
    const resources = await provider.listSyncableResources(integration, tokens);
    return NextResponse.json({ resources, selections });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'list_resources_failed';
    return NextResponse.json({ resources: [], selections, error: msg }, { status: 200 });
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const resolved = await resolveScope(session.user.id);
  if (!resolved) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const { scope } = resolved;
  try {
    await scope.requireMembership('admin');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const integration = await scope.integrations.getIntegration(id);
  if (!integration) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body: unknown = await req.json();
  const parsed = selectionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // Validate every proposed selection against `listSyncableResources` —
  // i.e. the integration's actual OAuth scope. Without this, an admin
  // could PUT an arbitrary externalId (a repo, project, folder, etc.
  // they don't actually have access to). On shared webhook URLs that's
  // a tenant-isolation hole: any team that adds "tenantA/private-repo"
  // to its selections receives tenantA's webhook payloads because the
  // delivery router matches selections alone. Validate here once so the
  // webhook + sync paths can trust the selection set.
  const tokens = await scope.integrations.getIntegrationTokens(id);
  if (!tokens) {
    return NextResponse.json({ error: 'no_tokens — reconnect required' }, { status: 400 });
  }
  let resources: { externalId: string; kind: string }[];
  try {
    const provider = integrationsLib.getProvider(integration.provider);
    resources = await provider.listSyncableResources(integration, tokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'list_resources_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const allowed = new Set(resources.map((r) => `${r.kind}\x00${r.externalId}`));
  const invalid = parsed.data.selections.filter(
    (s) => !allowed.has(`${s.kind}\x00${s.externalId}`),
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: 'selection_not_in_scope',
        invalid: invalid.map((s) => ({ kind: s.kind, externalId: s.externalId })),
      },
      { status: 400 },
    );
  }
  await scope.integrations.setSelections(id, parsed.data.selections);
  await scope.integrations.recordAudit(
    'selections_updated',
    { count: parsed.data.selections.length },
    id,
  );
  return NextResponse.json({ ok: true });
}
