import { createHmac, timingSafeEqual } from 'node:crypto';

import { childLogger, integrations as integrationsLib, getEnv, withTeam } from '@timeline/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:callback');

const PROVIDERS = new Set(['google_drive', 'linear', 'github']);

const stateSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(['google_drive', 'linear', 'github']),
  nonce: z.string(),
  iat: z.number(),
});

function verifyState(state: string): z.infer<typeof stateSchema> | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const env = getEnv();
  const expected = createHmac('sha256', env.AUTH_SECRET).update(payloadB64).digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigB64, 'utf8');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const parsed = stateSchema.parse(payload);
    // Reject expired state. The start route mints iat as Date.now() (ms);
    // the 15-minute window mirrors the MCP-side oauth-state JWT and is
    // long enough for a user to complete the upstream OAuth dance but
    // short enough to bound replay/fixation.
    const ageMs = Date.now() - parsed.iat;
    if (ageMs < 0 || ageMs > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  const { provider } = await ctx.params;
  if (!PROVIDERS.has(provider)) return new Response('unknown_provider', { status: 404 });
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
  const verified = verifyState(state);
  if (verified?.provider !== provider || verified.userId !== session.user.id) {
    return new Response('bad_state', { status: 400 });
  }
  const scope = withTeam(db, verified.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return new Response('forbidden', { status: 403 });
  }

  const p = integrationsLib.getProvider(provider);
  const redirectUri = `${url.origin}/api/integrations/${provider}/callback`;
  try {
    const result = await p.handleOAuthCallback({ code, redirectUri });
    const created = await scope.integrations.createIntegration({
      provider: provider,
      displayName: result.displayName,
      externalAccountId: result.externalAccountId,
      scopes: result.scopes,
      tokens: result.tokens,
    });
    await scope.integrations.recordAudit(
      'connect',
      { provider, externalAccountId: result.externalAccountId, displayName: result.displayName },
      created.id,
    );
    return NextResponse.redirect(
      new URL(`/app/team/integrations?connected=${provider}&integrationId=${created.id}`, req.url),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_callback_failed';
    log.warn({ err, provider }, 'oauth callback failed');
    return NextResponse.redirect(
      new URL(`/app/team/integrations?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
