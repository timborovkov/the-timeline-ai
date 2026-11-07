import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  decideGoogleDriveTokenRevoke,
  googleOAuthTokenFromDriveSecrets,
  GOOGLE_OAUTH_REVOKE_URL,
  revokeGoogleOAuthToken,
  type GoogleOAuthRevokeFetch,
} from '#src/integrations/google-drive-oauth-revoke.js';

describe('decideGoogleDriveTokenRevoke', () => {
  it('revokes only when no other Google grant on this project still needs the user', () => {
    expect(
      decideGoogleDriveTokenRevoke({
        token: 'refresh-token',
        googleSignInLinked: false,
        otherDriveConnectionsRemain: false,
      }),
    ).toEqual({ action: 'revoke', token: 'refresh-token' });
  });

  it('skips when Sign in with Google is linked to the same subject', () => {
    expect(
      decideGoogleDriveTokenRevoke({
        token: 'refresh-token',
        googleSignInLinked: true,
        otherDriveConnectionsRemain: false,
      }),
    ).toEqual({ action: 'skip', reason: 'google_sign_in_linked' });
  });

  it('skips when another Drive connection still holds the same Google account', () => {
    expect(
      decideGoogleDriveTokenRevoke({
        token: 'refresh-token',
        googleSignInLinked: false,
        otherDriveConnectionsRemain: true,
      }),
    ).toEqual({ action: 'skip', reason: 'other_drive_connection' });
  });

  it('skips when no token is available', () => {
    expect(
      decideGoogleDriveTokenRevoke({
        token: '  ',
        googleSignInLinked: false,
        otherDriveConnectionsRemain: false,
      }),
    ).toEqual({ action: 'skip', reason: 'no_token' });
  });
});

describe('googleOAuthTokenFromDriveSecrets', () => {
  it('prefers the refresh token so Google can invalidate the grant', () => {
    expect(
      googleOAuthTokenFromDriveSecrets({
        refresh_token: 'refresh-token',
        access_token: 'access-token',
      }),
    ).toBe('refresh-token');
  });

  it('falls back to the access token', () => {
    expect(googleOAuthTokenFromDriveSecrets({ access_token: 'access-token' })).toBe('access-token');
  });
});

describe('revokeGoogleOAuthToken', () => {
  it('posts the token to Google’s revoke endpoint', async () => {
    const fetchImpl: GoogleOAuthRevokeFetch = (input, init) => {
      expect(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      ).toBe(GOOGLE_OAUTH_REVOKE_URL);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
      expect(init?.body).toBe('token=refresh-token');
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    await expect(revokeGoogleOAuthToken('refresh-token', fetchImpl)).resolves.toBe('revoked');
  });

  it('treats an already-invalid token as success', async () => {
    const fetchImpl: GoogleOAuthRevokeFetch = () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 }));
    await expect(revokeGoogleOAuthToken('stale', fetchImpl)).resolves.toBe('already_invalid');
  });

  it('does not throw when Google is unreachable', async () => {
    const fetchImpl: GoogleOAuthRevokeFetch = () => Promise.reject(new Error('network down'));
    await expect(revokeGoogleOAuthToken('refresh-token', fetchImpl)).resolves.toBe('failed');
  });
});
