import * as integrationsLib from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicApiErrorResponse } from '@/lib/public-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const resourcesSchema = z.object({
  resources: z.array(
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
  return { active, scope: withTeam(db, active.teamId, userId) };
}

function serializeConnection(connection: {
  id: string;
  ownerUserId: string;
  provider: string;
  displayName: string;
  externalAccountId: string | null;
  scopes: string[] | null;
  lastError: string | null;
  lastConnectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    ownerUserId: connection.ownerUserId,
    provider: connection.provider,
    displayName: connection.displayName,
    externalAccountId: connection.externalAccountId,
    scopes: connection.scopes,
    lastError: connection.lastError ? 'connection_attention_required' : null,
    lastConnectedAt: connection.lastConnectedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
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
  const connection = await scope.integrations.getOwnedProviderConnection(id);
  if (!connection) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const tokens = await scope.integrations.getProviderConnectionTokens(id);
  if (!tokens) return NextResponse.json({ error: 'no_tokens' }, { status: 400 });
  const provider = integrationsLib.getProvider(connection.provider);
  let resources;
  try {
    resources = await provider.listSyncableResources(
      {
        id: connection.id,
        teamId: resolved.active.teamId,
        connectedByUserId: connection.ownerUserId,
        providerConnectionId: connection.id,
        provider: connection.provider,
        displayName: connection.displayName,
        externalAccountId: connection.externalAccountId,
        scopes: connection.scopes,
        authSecretCiphertext: null,
        authSecretIv: null,
        authSecretTag: null,
        visibilityDefault: 'team',
        visibilityDefaultUserIds: null,
        enabled: true,
        lastError: connection.lastError,
        lastSyncedAt: null,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
      tokens,
      {
        persistTokens: (fresh) =>
          integrationsLib.adminPersistProviderConnectionTokens(db, connection.id, fresh),
      },
    );
  } catch (err) {
    return publicApiErrorResponse(err, {
      operation: 'list_owned_connection_resources',
      fallbackCode: 'list_resources_failed',
      fallbackStatus: 502,
    });
  }
  let shares;
  try {
    shares = await scope.integrations.listOwnedTeamResourceShares();
  } catch {
    return NextResponse.json({ error: 'list_resource_shares_failed' }, { status: 500 });
  }
  const connectionShares = [];
  for (const row of shares) {
    if (row.connection.id === connection.id) connectionShares.push(row.share);
  }
  return NextResponse.json({
    connection: serializeConnection(connection),
    resources,
    shares: connectionShares,
  });
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
  const connection = await scope.integrations.getOwnedProviderConnection(id);
  if (!connection) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = resourcesSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const tokens = await scope.integrations.getProviderConnectionTokens(id);
  if (!tokens) return NextResponse.json({ error: 'no_tokens' }, { status: 400 });
  const provider = integrationsLib.getProvider(connection.provider);
  const available = await provider.listSyncableResources(
    {
      id: connection.id,
      teamId: resolved.active.teamId,
      connectedByUserId: connection.ownerUserId,
      providerConnectionId: connection.id,
      provider: connection.provider,
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId,
      scopes: connection.scopes,
      authSecretCiphertext: null,
      authSecretIv: null,
      authSecretTag: null,
      visibilityDefault: 'team',
      visibilityDefaultUserIds: null,
      enabled: true,
      lastError: connection.lastError,
      lastSyncedAt: null,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    },
    tokens,
    {
      persistTokens: (fresh) =>
        integrationsLib.adminPersistProviderConnectionTokens(db, connection.id, fresh),
    },
  );
  const allowed = new Set(available.map((r) => `${r.kind}\x00${r.externalId}`));
  const shares = await scope.integrations.listOwnedTeamResourceShares();
  for (const row of shares) {
    if (row.connection.id !== connection.id || row.share.revokedAt) continue;
    allowed.add(`${row.share.resourceKind}\x00${row.share.externalId}`);
  }
  const invalid = parsed.data.resources.filter((r) => !allowed.has(`${r.kind}\x00${r.externalId}`));
  if (invalid.length > 0) {
    return NextResponse.json({ error: 'resource_not_in_scope', invalid }, { status: 400 });
  }
  await scope.integrations.shareProviderResources(id, parsed.data.resources);
  return NextResponse.json({ ok: true });
}
