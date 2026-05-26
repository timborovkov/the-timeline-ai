import { childLogger, mcp, withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:mcp:oauth:callback');

/**
 * GET /api/mcp/oauth/callback?code&state
 *
 * Verifies the HMAC state JWT, restores (teamId, mcpServerId, userId), loads
 * the persisted client_info + PKCE verifier, exchanges the code for tokens,
 * and stores them encrypted on `mcp_oauth_tokens`. The user lands back on
 * `/app/team/mcp-servers`.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/app/team/integrations?error=${encodeURIComponent(oauthError)}`, req.url),
    );
  }
  if (!code || !state) {
    return new Response('missing_code_or_state', { status: 400 });
  }
  const verified = mcp.verifyOAuthState(state);
  if (verified?.userId !== session.user.id) {
    return new Response('bad_state', { status: 400 });
  }

  const scope = withTeam(db, verified.teamId, session.user.id);
  const server = await scope.mcp.getServer(verified.mcpServerId);
  if (!server) return new Response('not_found', { status: 404 });
  // Personal MCP servers: the owner OAuths against their own identity, no
  // admin role needed. Team-shared servers: admin only.
  if (server.userId === null) {
    try {
      await scope.requireMembership('admin');
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  } else if (server.userId !== session.user.id) {
    return new Response('forbidden', { status: 403 });
  }
  const { clientInfo, codeVerifier, hasExistingTokens } = await scope.mcp.loadOauthClientInfo(
    verified.mcpServerId,
  );
  if (!clientInfo || !codeVerifier) {
    return new Response('missing_pending_state', { status: 400 });
  }

  const redirectUri = `${url.origin}/api/mcp/oauth/callback`;
  try {
    // Reuse the authorization-server metadata pinned at /start so the
    // code exchange hits the same `token_endpoint` the user consented at.
    // A connected MCP could otherwise rotate its well-known between
    // authorize and callback and exfiltrate the code to a different
    // token endpoint. Falls back to fresh discovery only for legacy
    // pending rows persisted before pinning landed.
    const pinned = (clientInfo as { __discovery?: unknown }).__discovery;
    const discovery =
      pinned && typeof pinned === 'object'
        ? (pinned as Awaited<ReturnType<typeof mcp.discoverOAuth>>)
        : await mcp.discoverOAuth(server.url);
    const clientId = (clientInfo as { client_id?: string }).client_id;
    const clientSecret = (clientInfo as { client_secret?: string }).client_secret;
    if (!clientId) throw new Error('client_id missing from stored client_info');
    const tokens = await mcp.exchangeCode({
      discovery,
      code,
      redirectUri,
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      codeVerifier,
    });
    const expiresAt = tokens.expires_at ? new Date(tokens.expires_at) : null;
    // Always persist `__discovery` on the clientInfo blob — refresh now
    // strictly requires it. Legacy pending rows (created before /start
    // pinned discovery) fell back to fresh-discovery above, but without
    // also stamping that discovery onto the stored clientInfo the row
    // would still be missing `__discovery` and the next refresh would
    // trip `oauth_refresh_no_pinned_discovery` even though connect just
    // succeeded.
    const persistedClientInfo: Record<string, unknown> = {
      ...clientInfo,
      __discovery: discovery,
    };
    await scope.mcp.persistOauthTokens(
      verified.mcpServerId,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type ?? 'Bearer',
        scope: tokens.scope,
        expiresAt: tokens.expires_at,
      },
      expiresAt,
      {
        clientInfo: persistedClientInfo,
        // Clear the verifier now that the code was redeemed (replay defense).
        codeVerifier: null,
      },
    );
    // First-connect: flip enabled true so the server starts serving
    // tools. Re-auth (tokens existed before): leave `enabled` alone —
    // if an admin deliberately disabled this server while authorization
    // was in flight (or before a token refresh), completing OAuth must
    // NOT silently re-enable it. The /reconnect path through the chat
    // UI explicitly toggles enabled separately for the legitimate case.
    if (!hasExistingTokens) {
      await scope.mcp.updateServer(verified.mcpServerId, { enabled: true });
    }
    return NextResponse.redirect(
      new URL(`/app/team/integrations?connected=${verified.mcpServerId}`, req.url),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'mcp_oauth_callback_failed';
    log.warn({ err, mcpServerId: verified.mcpServerId }, 'mcp oauth callback failed');
    return NextResponse.redirect(
      new URL(`/app/team/integrations?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
