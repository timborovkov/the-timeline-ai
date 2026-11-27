import { isNativeProviderId } from '@timeline/db/integration-providers';
import * as integrationsLib from '@timeline/shared/integrations';
import { childLogger } from '@timeline/shared/logger';
import { NextResponse } from 'next/server';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { integrationOAuthRedirectUri, signIntegrationOAuthState } from '@/lib/integration-oauth';
import { publicApiErrorResponse } from '@/lib/public-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:start');

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { provider } = await ctx.params;
  if (!isNativeProviderId(provider)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return NextResponse.json({ error: 'no_team' }, { status: 400 });
  // Any current team member can create their own provider connection.
  // Admin is still required later to activate shared resources for team sync.
  const state = signIntegrationOAuthState(active.teamId, session.user.id, provider);
  const redirectUri = integrationOAuthRedirectUri(provider);

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
