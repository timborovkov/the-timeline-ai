import { randomBytes } from 'node:crypto';

import { getEnv } from '@timeline/shared/env';
import * as integrationsLib from '@timeline/shared/integrations';
import { childLogger } from '@timeline/shared/logger';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { publicApiErrorResponse } from '@/lib/public-error';
import { appUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:start');

const PROVIDER_VALUES = ['google_drive', 'linear', 'github', 'monday', 'slack', 'sentry'] as const;
const PROVIDERS = new Set<string>(PROVIDER_VALUES);

const stateSchema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  provider: z.enum(PROVIDER_VALUES),
  nonce: z.string(),
  iat: z.number(),
});

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { provider } = await ctx.params;
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  // Any current team member can create their own provider connection.
  // Admin is still required later to activate shared resources for team sync.
  // Build a self-contained state JWT-equivalent (HMAC-SHA256 of payload
  // with AUTH_SECRET). We could route through the MCP oauth-state but
  // this is a different audience — keep them separate.
  const env = getEnv();
  const secret = env.AUTH_SECRET;
  const payload = stateSchema.parse({
    teamId: active.teamId,
    userId: session.user.id,
    provider,
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  });
  const { createHmac } = await import('node:crypto');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const state = `${payloadB64}.${sig}`;

  const redirectUri = appUrl(`/api/integrations/${provider}/callback`).toString();

  try {
    const p = integrationsLib.getProvider(provider);
    const { authorizeUrl } = await p.startOAuth({
      teamId: active.teamId,
      userId: session.user.id,
      redirectUri,
      state,
    });
    return NextResponse.json({ url: authorizeUrl });
  } catch (err) {
    log.warn({ err, provider }, 'oauth start failed');
    return publicApiErrorResponse(err, {
      operation: 'integration_oauth_start',
      fallbackCode: 'oauth_start_failed',
    });
  }
}
