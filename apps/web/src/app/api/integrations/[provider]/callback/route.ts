import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';
import * as integrationsLib from '@timeline/shared/integrations';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { publicApiError } from '@/lib/public-error';
import { appUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:callback');

const PROVIDER_VALUES = ['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry'] as const;
const PROVIDERS = new Set<string>(PROVIDER_VALUES);

const stateSchema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  provider: z.enum(PROVIDER_VALUES),
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
    return NextResponse.redirect(appUrl('/sign-in'));
  }
  const { provider } = await ctx.params;
  if (!PROVIDERS.has(provider)) return new Response('unknown_provider', { status: 404 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(appUrl('/app/team/integrations?error=oauth_denied'));
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
    await scope.requireMembership();
  } catch {
    return new Response('forbidden', { status: 403 });
  }

  const p = integrationsLib.getProvider(provider);
  const redirectUri = appUrl(`/api/integrations/${provider}/callback`).toString();
  try {
    const result = await p.handleOAuthCallback({ code, redirectUri });
    const created = await scope.integrations.upsertProviderConnection({
      provider,
      displayName: result.displayName,
      externalAccountId: result.externalAccountId,
      scopes: result.scopes,
      tokens: result.tokens,
    });
    await scope.integrations.recordAudit(
      'connect',
      { provider, externalAccountId: result.externalAccountId, displayName: result.displayName },
      null,
    );
    trackProductEventBestEffort(session.user.id, 'integration_connected', {
      teamId: verified.teamId,
      userId: session.user.id,
      providerConnectionId: created.id,
      provider,
    });
    return NextResponse.redirect(
      appUrl(`/app/me/connections?connected=${provider}&providerConnectionId=${created.id}`),
    );
  } catch (err) {
    log.warn({ err, provider }, 'oauth callback failed');
    const failure = publicApiError(err, {
      operation: 'integration_oauth_callback',
      fallbackCode: 'oauth_callback_failed',
    });
    return NextResponse.redirect(
      appUrl(
        `/app/team/integrations?error=${failure.error}${failure.reference ? `&reference=${failure.reference}` : ''}`,
      ),
    );
  }
}
