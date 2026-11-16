export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

type GoogleDriveRevokeSkipReason = 'no_token' | 'google_sign_in_linked' | 'other_drive_connection';

export type GoogleDriveRevokeDecision =
  { action: 'revoke'; token: string } | { action: 'skip'; reason: GoogleDriveRevokeSkipReason };

export type GoogleOAuthRevokeResult = 'revoked' | 'already_invalid' | 'failed';

/**
 * Google's revoke endpoint invalidates the user grant for the Cloud project,
 * not one client or one scope. Sign-in with Google on this same project would
 * lose its tokens if Drive disconnect revoked. Skip when that grant is still
 * needed.
 *
 * @see https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
 */
export function decideGoogleDriveTokenRevoke(input: {
  token: string | null | undefined;
  googleSignInLinked: boolean;
  otherDriveConnectionsRemain: boolean;
}): GoogleDriveRevokeDecision {
  const token = input.token?.trim() ?? '';
  if (!token) return { action: 'skip', reason: 'no_token' };
  if (input.googleSignInLinked) return { action: 'skip', reason: 'google_sign_in_linked' };
  if (input.otherDriveConnectionsRemain) {
    return { action: 'skip', reason: 'other_drive_connection' };
  }
  return { action: 'revoke', token };
}

export function googleOAuthTokenFromDriveSecrets(
  tokens: Record<string, unknown> | null | undefined,
): string | null {
  if (!tokens) return null;
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token.trim() : '';
  if (refresh) return refresh;
  const access = typeof tokens.access_token === 'string' ? tokens.access_token.trim() : '';
  return access || null;
}

export type GoogleOAuthRevokeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function revokeGoogleOAuthToken(
  token: string,
  fetchImpl: GoogleOAuthRevokeFetch = fetch,
): Promise<GoogleOAuthRevokeResult> {
  try {
    const response = await fetchImpl(GOOGLE_OAUTH_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return 'revoked';
    if (response.status === 400) return 'already_invalid';
    return 'failed';
  } catch {
    return 'failed';
  }
}
