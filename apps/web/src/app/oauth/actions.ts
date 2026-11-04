'use server';

import {
  createMcpAuthorizationCode,
  resolveMcpOAuthConsentScopes,
  revokeMcpOAuthGrant,
  validateMcpAuthorizationRequest,
  withMcpOAuthTrustedAuthorizationRedirect,
} from '@timeline/shared/mcp-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import {
  authorizationInputFromFormData,
  MCP_AUTHORIZATION_NOTICES,
  mcpAuthorizationLegalAcceptancePath,
  mcpAuthorizationPath,
} from '@/lib/mcp-oauth-authorization';
import {
  mcpOAuthResource,
  oauthAuthorizationErrorRedirect,
  oauthAuthorizationRedirect,
} from '@/lib/mcp-oauth-server';
import { reportCaughtError } from '@/lib/sentry-report';

const CONNECT_AGENT_RETURN = '/app/connect-agent';
const PERSONAL_CONNECTIONS_RETURN = '/app/me/connections';

const grantFormSchema = z.object({
  grantId: z.uuid(),
  teamId: z.uuid(),
  returnTo: z.enum([CONNECT_AGENT_RETURN, PERSONAL_CONNECTIONS_RETURN]).optional(),
});

function mcpGrantReturnPath(
  returnTo: string | undefined,
  query:
    'mcpError=invalid_request' | 'mcpError=revoke_failed' | 'mcpError=not_found' | 'mcpRevoked=1',
): string {
  const base =
    returnTo === CONNECT_AGENT_RETURN ? CONNECT_AGENT_RETURN : PERSONAL_CONNECTIONS_RETURN;
  return `${base}?${query}`;
}

function consentFailurePath(input: ReturnType<typeof authorizationInputFromFormData>): string {
  return mcpAuthorizationPath(input, MCP_AUTHORIZATION_NOTICES.requestFailed);
}

function authorizationFailurePath(
  input: ReturnType<typeof authorizationInputFromFormData>,
  error: unknown,
): string {
  return oauthAuthorizationErrorRedirect(error) ?? consentFailurePath(input);
}

export async function approveMcpOAuthAction(formData: FormData): Promise<void> {
  const input = authorizationInputFromFormData(formData);
  const callbackPath = mcpAuthorizationPath(input);
  const session = await auth();
  if (!session?.user.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }

  let validation:
    | {
        ok: true;
        request: Awaited<ReturnType<typeof validateMcpAuthorizationRequest>>;
      }
    | { ok: false; destination: string };
  try {
    validation = {
      ok: true,
      request: await validateMcpAuthorizationRequest(db, input, mcpOAuthResource()),
    };
  } catch (error) {
    reportCaughtError(error, {
      surface: 'server_action',
      operation: 'mcp_oauth_consent_approve',
    });
    validation = { ok: false, destination: authorizationFailurePath(input, error) };
  }
  if (!validation.ok) {
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- An external destination exists only when validation attached the exact registered redirect URI; otherwise this stays on Timeline.
    redirect(validation.destination);
  }
  const { request } = validation;

  const legal = await getUserLegalAcceptance(session.user.id);
  if (!legal || !hasCurrentLegalAcceptance(legal)) {
    redirect(mcpAuthorizationLegalAcceptancePath(input));
  }
  const teamId = formData.get('team_id');
  if (typeof teamId !== 'string' || !z.uuid().safeParse(teamId).success) {
    redirect(mcpAuthorizationPath(input, MCP_AUTHORIZATION_NOTICES.invalidTeam));
  }

  const grantCapture =
    formData.get('grant_capture') === '1' || formData.get('grant_capture') === 'on';
  const grantedScopes = resolveMcpOAuthConsentScopes(request.scopes, { grantCapture });

  let issuance: { ok: true; code: string } | { ok: false; destination: string };
  try {
    issuance = {
      ok: true,
      code: await createMcpAuthorizationCode(db, {
        request,
        userId: session.user.id,
        teamId,
        grantedScopes,
      }),
    };
  } catch (error) {
    reportCaughtError(error, {
      surface: 'server_action',
      operation: 'mcp_oauth_consent_approve',
    });
    const trustedError = withMcpOAuthTrustedAuthorizationRedirect(error, {
      redirectUri: request.redirectUri,
      state: request.state,
    });
    issuance = { ok: false, destination: authorizationFailurePath(input, trustedError) };
  }
  if (!issuance.ok) {
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- The destination is the exact registered redirect URI revalidated above; only a code-owned error and the validated state are returned.
    redirect(issuance.destination);
  }
  const destination = oauthAuthorizationRedirect(request.redirectUri, {
    code: issuance.code,
    state: request.state,
  });
  // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- The destination is the exact registered redirect URI revalidated immediately above; state and issuer binding are preserved.
  redirect(destination);
}

export async function denyMcpOAuthAction(formData: FormData): Promise<void> {
  const input = authorizationInputFromFormData(formData);
  const callbackPath = mcpAuthorizationPath(input);
  const session = await auth();
  if (!session?.user.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`);
  }

  let validation:
    | {
        ok: true;
        request: Awaited<ReturnType<typeof validateMcpAuthorizationRequest>>;
      }
    | { ok: false; destination: string };
  try {
    validation = {
      ok: true,
      request: await validateMcpAuthorizationRequest(db, input, mcpOAuthResource()),
    };
  } catch (error) {
    reportCaughtError(error, {
      surface: 'server_action',
      operation: 'mcp_oauth_consent_deny',
    });
    validation = { ok: false, destination: authorizationFailurePath(input, error) };
  }
  if (!validation.ok) {
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- An external destination exists only when validation attached the exact registered redirect URI; otherwise this stays on Timeline.
    redirect(validation.destination);
  }
  const { request } = validation;
  const destination = oauthAuthorizationRedirect(request.redirectUri, {
    error: 'access_denied',
    error_description: 'The authorization request was denied.',
    state: request.state,
  });
  // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- The destination is the exact registered redirect URI revalidated immediately above; state and issuer binding are preserved.
  redirect(destination);
}

export async function revokeMcpOAuthGrantAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user.id) redirect('/sign-in');
  const returnToValue = formData.get('return_to');
  const parsed = grantFormSchema.safeParse({
    grantId: formData.get('grant_id'),
    teamId: formData.get('team_id'),
    returnTo:
      typeof returnToValue === 'string' && returnToValue.length > 0 ? returnToValue : undefined,
  });
  if (!parsed.success) redirect('/app/me/connections?mcpError=invalid_request');
  let revoked = false;
  let failure: unknown;
  try {
    revoked = await revokeMcpOAuthGrant(db, {
      grantId: parsed.data.grantId,
      userId: session.user.id,
      teamId: parsed.data.teamId,
    });
  } catch (error) {
    failure = error;
  }
  if (failure) {
    reportCaughtError(failure, {
      surface: 'server_action',
      operation: 'mcp_oauth_grant_revoke',
    });
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- Destination is an allowlisted Timeline path, either Connect your agent or personal connections.
    redirect(mcpGrantReturnPath(parsed.data.returnTo, 'mcpError=revoke_failed'));
  }
  if (!revoked) {
    // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- Destination is an allowlisted Timeline path, either Connect your agent or personal connections.
    redirect(mcpGrantReturnPath(parsed.data.returnTo, 'mcpError=not_found'));
  }
  revalidatePath('/app/me/connections');
  revalidatePath('/app/connect-agent');
  // react-doctor-disable-next-line react-doctor/clickjacking-redirect-risk -- Destination is an allowlisted Timeline path, either Connect your agent or personal connections.
  redirect(mcpGrantReturnPath(parsed.data.returnTo, 'mcpRevoked=1'));
}
