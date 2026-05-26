import { childLogger, mcp, withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:mcp:oauth:start');

const startSchema = z.object({
  mcpServerId: z.string().uuid(),
  scopes: z.array(z.string().max(64)).max(20).optional(),
});

/**
 * POST /api/mcp/oauth/start
 *
 * Body: { mcpServerId, scopes? }
 *
 * 1. Looks up the MCP server row (team-scoped — admin required).
 * 2. Discovers the OAuth authorization server from the resource URL.
 * 3. Uses a pre-registered client when env declares one for the origin;
 *    otherwise dynamically registers a client with the AS.
 * 4. Generates PKCE + state and persists the verifier/client_info.
 * 5. Returns the authorize URL for the browser to follow.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  const body: unknown = await req.json();
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const scope = withTeam(db, active.teamId, session.user.id);
  const server = await scope.mcp.getServer(parsed.data.mcpServerId);
  if (!server) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (server.authType !== 'oauth') {
    return NextResponse.json({ error: 'not_oauth_server' }, { status: 400 });
  }
  // Personal MCP servers (user_id set): the owner OAuths against their own
  // identity, no admin role needed. Team-shared servers (user_id null):
  // admin only, matching the rest of the team-catalog gates.
  if (server.userId === null) {
    try {
      await scope.requireMembership('admin');
    } catch {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  } else if (server.userId !== session.user.id) {
    // getServer already filters by visibility, so this branch should be
    // unreachable — defense in depth in case the visibility predicate
    // ever loosens.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/mcp/oauth/callback`;
  try {
    const discovery = await mcp.discoverOAuth(server.url);
    let clientId: string;
    let clientSecret: string | undefined;
    let clientInfoToStore: Record<string, unknown>;
    const preregistered = mcp.findPreregisteredClient(server.url);
    if (preregistered) {
      clientId = preregistered.clientId;
      clientSecret = preregistered.clientSecret;
      // Persist the client_secret too — callback + refresh both read it
      // out of this blob. Without it, confidential pre-registered clients
      // can't complete the token exchange or any future refresh.
      // Encrypted at rest via persistOauthPending's encryptJson.
      clientInfoToStore = {
        client_id: clientId,
        preregistered: true,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      };
    } else {
      if (!discovery.registration_endpoint) {
        return NextResponse.json(
          {
            error: 'no_dynamic_registration',
            hint:
              'This server does not advertise a registration_endpoint and no pre-registered ' +
              'MCP_PREREGISTERED_<NAME>_CLIENT_ID is configured for its origin.',
          },
          { status: 400 },
        );
      }
      const issued = await mcp.registerClient(
        discovery.registration_endpoint,
        redirectUri,
        `The Timeline — ${server.name}`,
      );
      clientId = issued.client_id;
      clientSecret = issued.client_secret;
      clientInfoToStore = issued as unknown as Record<string, unknown>;
    }
    // Pin the authorization-server metadata from THIS authorize roundtrip so
    // the callback and any future refresh hit the same `token_endpoint` the
    // user actually consented at. Without pinning, a malicious/compromised
    // resource could rotate its well-known to point at a different token
    // endpoint between authorize and callback (token exfiltration).
    clientInfoToStore = { ...clientInfoToStore, __discovery: discovery };

    const { codeVerifier, codeChallenge } = mcp.generatePkcePair();
    await scope.mcp.persistOauthPending(server.id, codeVerifier, clientInfoToStore);

    const state = mcp.signOAuthState({
      teamId: active.teamId,
      mcpServerId: server.id,
      userId: session.user.id,
    });
    const authorizeUrl = mcp.buildAuthorizeUrl({
      discovery,
      clientId,
      redirectUri,
      state,
      codeChallenge,
      ...(parsed.data.scopes ? { scopes: parsed.data.scopes } : {}),
    });
    // clientSecret is intentionally not in the response (still encrypted in DB
    // for the callback to use).
    void clientSecret;
    return NextResponse.json({ url: authorizeUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'mcp_oauth_start_failed';
    log.warn({ err, mcpServerId: parsed.data.mcpServerId }, 'mcp oauth start failed');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
