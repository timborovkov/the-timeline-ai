import { integrations as integrationsLib, withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Two shapes accepted:
//   1. Catalog shortcut `{ catalogId, bearerToken?, header? }` — server
//      looks up the prebaked mcpUrl / mcpAuthType from the registry and
//      adds the server with the right config. Used by one-click Connect
//      buttons on /app/team/mcp-servers.
//   2. Free-form `{ name, url, authType, authConfig? }` — for custom MCP
//      endpoints not in the catalog.
const catalogShortcutSchema = z.object({
  catalogId: z.string().min(1).max(64),
  bearerToken: z.string().min(1).max(8192).optional(),
  header: z
    .object({ name: z.string().min(1).max(64), value: z.string().min(1).max(8192) })
    .optional(),
});

const customSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().max(1024),
  authType: z.enum(['none', 'bearer', 'header', 'basic', 'oauth', 'url_key']),
  authConfig: z
    .union([
      z.object({ token: z.string().min(1).max(8192) }),
      z.object({ name: z.string().min(1).max(64), value: z.string().min(1).max(8192) }),
      z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(8192) }),
      z.object({ paramName: z.string().min(1).max(64), value: z.string().min(1).max(8192) }),
    ])
    .optional()
    .nullable(),
  // Phase 11 overlay: 'team' (default, admin-only) vs 'personal' (caller-
  // owned, any member can add). Catalog shortcuts always create team rows.
  ownership: z.enum(['team', 'personal']).optional(),
});

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const scope = withTeam(db, active.teamId, session.user.id);
  const servers = await scope.mcp.listServers();
  return NextResponse.json({
    servers: servers.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      authType: s.authType,
      enabled: s.enabled,
      cachedTools: s.cachedTools,
      toolsCachedAt: s.toolsCachedAt,
      lastConnectedAt: s.lastConnectedAt,
      lastError: s.lastError,
      disabledTools: s.disabledTools,
      createdAt: s.createdAt,
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const body: unknown = await req.json();
  const scope = withTeam(db, active.teamId, session.user.id);

  // Catalog shortcut path — look up URL + auth from the registry.
  const catalogResult = catalogShortcutSchema.safeParse(body);
  if (catalogResult.success) {
    const entry = integrationsLib
      .listCatalog()
      .find((c) => c.id === catalogResult.data.catalogId && c.kind === 'mcp');
    if (!entry?.mcpUrl || !entry.mcpAuthType) {
      return NextResponse.json({ error: 'unknown_catalog_entry' }, { status: 400 });
    }
    let authConfig: Parameters<typeof scope.mcp.addServer>[0]['authConfig'] = null;
    if (entry.mcpAuthType === 'bearer') {
      if (!catalogResult.data.bearerToken) {
        return NextResponse.json({ error: 'bearer_token_required' }, { status: 400 });
      }
      authConfig = { token: catalogResult.data.bearerToken };
    } else if (entry.mcpAuthType === 'header') {
      if (!catalogResult.data.header) {
        return NextResponse.json({ error: 'header_required' }, { status: 400 });
      }
      authConfig = catalogResult.data.header;
    }
    try {
      const server = await scope.mcp.addServer({
        name: entry.label,
        url: entry.mcpUrl,
        authType: entry.mcpAuthType,
        authConfig,
      });
      return NextResponse.json({
        id: server.id,
        catalogId: entry.id,
        // The client uses this to decide whether to immediately POST
        // /api/mcp/oauth/start for OAuth-type servers.
        needsOauth: entry.mcpAuthType === 'oauth',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'add_failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // Free-form path — custom MCP not in the catalog.
  const custom = customSchema.safeParse(body);
  if (!custom.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: custom.error.issues },
      { status: 400 },
    );
  }
  try {
    const server = await scope.mcp.addServer({
      name: custom.data.name,
      url: custom.data.url,
      authType: custom.data.authType,
      authConfig: custom.data.authConfig ?? null,
      ...(custom.data.ownership ? { ownership: custom.data.ownership } : {}),
    });
    return NextResponse.json({ id: server.id, needsOauth: custom.data.authType === 'oauth' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'add_failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
