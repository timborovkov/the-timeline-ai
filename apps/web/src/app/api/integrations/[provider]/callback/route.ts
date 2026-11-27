import { isNativeProviderId } from '@timeline/db/integration-providers';
import * as integrationsLib from '@timeline/shared/integrations';
import { childLogger } from '@timeline/shared/logger';
import { withTeam } from '@timeline/shared/team-scope';
import { NextResponse } from 'next/server';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { connectionsHref } from '@/lib/connections';
import { db } from '@/lib/db';
import { integrationOAuthRedirectUri, verifyIntegrationOAuthState } from '@/lib/integration-oauth';
import { publicApiError } from '@/lib/public-error';
import { appUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:integrations:callback');

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.redirect(appUrl('/sign-in'));
  }
  const { provider } = await ctx.params;
  if (!isNativeProviderId(provider)) return new Response('unknown_provider', { status: 404 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(appUrl(connectionsHref({ error: 'oauth_denied' })));
  }
  if (!code || !state) {
    return new Response('missing_code_or_state', { status: 400 });
  }
  const verified = verifyIntegrationOAuthState(state);
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
  const redirectUri = integrationOAuthRedirectUri(provider);
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
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: verified.teamId },
      'integration_connected',
      {
        provider,
      },
    );
    trackProductEventBestEffort(
      { kind: 'user', userId: session.user.id, teamId: verified.teamId },
      'integration_management_action_completed',
      { action: 'connect', kind: 'native', provider },
    );
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
        connectionsHref({
          error: failure.error,
          ...(failure.reference ? { reference: failure.reference } : {}),
        }),
      ),
    );
  }
}
