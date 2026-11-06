import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  authenticationMethod,
  decideOAuthSignIn,
  googleSignInAuthorizationParams,
  googleSignInRequestsDriveAccess,
  googleSignInScopeList,
  GOOGLE_SIGN_IN_SCOPES,
  isGitHubEmailVerified,
  isGoogleEmailVerified,
  oauthClientConfigured,
  oauthCreateUserAlreadyVerified,
  oauthProviderAssertsVerifiedEmail,
  oauthSignInErrorMessage,
  planOAuthCreateUserEmail,
  readGitHubOAuthProfile,
  rememberOAuthRegistration,
  selectGitHubAccountEmail,
  takeOAuthRegistration,
} from '@/lib/oauth-sign-in';

describe('oauthClientConfigured', () => {
  it('requires both a non-empty client id and secret', () => {
    expect(oauthClientConfigured('id', 'secret')).toBe(true);
    expect(oauthClientConfigured('', 'secret')).toBe(false);
    expect(oauthClientConfigured('id', '')).toBe(false);
    expect(oauthClientConfigured(undefined, 'secret')).toBe(false);
    expect(oauthClientConfigured('id', undefined)).toBe(false);
  });
});

describe('Google sign-in scopes', () => {
  it('splits space-separated identity scopes instead of treating s as a separator', () => {
    expect(googleSignInScopeList('openid email profile')).toEqual(['openid', 'email', 'profile']);
    expect(googleSignInScopeList('openid+email+profile')).toEqual(['openid', 'email', 'profile']);
    expect(googleSignInScopeList('openid email profile').sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
  });

  it('requests only OpenID identity scopes and never Drive access', () => {
    const params = googleSignInAuthorizationParams();
    expect(params.scope.split(' ')).toEqual([...GOOGLE_SIGN_IN_SCOPES]);
    expect(googleSignInScopeList(params.scope).sort()).toEqual(['email', 'openid', 'profile']);
    expect(googleSignInRequestsDriveAccess(params.scope)).toBe(false);
    expect(params.include_granted_scopes).toBe('false');
    expect(params).not.toHaveProperty('access_type');
    expect(params).not.toHaveProperty('prompt');
    expect(GOOGLE_SIGN_IN_SCOPES).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(GOOGLE_SIGN_IN_SCOPES).not.toContain(
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    );
  });

  it('detects Drive scopes if they are mixed into an authorize URL', () => {
    expect(
      googleSignInRequestsDriveAccess(
        'openid email profile https://www.googleapis.com/auth/drive.readonly',
      ),
    ).toBe(true);
  });
});

describe('isGoogleEmailVerified', () => {
  it('accepts only a boolean true email_verified claim', () => {
    expect(isGoogleEmailVerified({ email_verified: true })).toBe(true);
    expect(isGoogleEmailVerified({ email_verified: false })).toBe(false);
    expect(isGoogleEmailVerified({ email_verified: 'true' })).toBe(false);
    expect(isGoogleEmailVerified({})).toBe(false);
    expect(isGoogleEmailVerified(null)).toBe(false);
  });
});

describe('GitHub account email', () => {
  it('prefers a verified primary address and ignores unverified emails', () => {
    expect(
      selectGitHubAccountEmail([
        { email: 'old@example.com', primary: true, verified: false },
        { email: 'work@example.com', primary: false, verified: true },
      ]),
    ).toEqual({ email: 'work@example.com', verified: true });
    expect(
      selectGitHubAccountEmail([
        { email: 'private@example.com', primary: true, verified: true },
        { email: 'other@example.com', primary: false, verified: true },
      ]),
    ).toEqual({ email: 'private@example.com', verified: true });
    expect(
      selectGitHubAccountEmail([
        { email: 'unverified@example.com', primary: true, verified: false },
      ]),
    ).toBeNull();
  });

  it('treats only a boolean true email_verified claim as GitHub verification', () => {
    expect(isGitHubEmailVerified({ email_verified: true })).toBe(true);
    expect(isGitHubEmailVerified({ email_verified: false })).toBe(false);
    expect(isGitHubEmailVerified({ email: 'user@example.com' })).toBe(false);
  });

  it('copies a verified GitHub email onto the OAuth profile', async () => {
    const fetchImpl = (href: string) => {
      if (href.endsWith('/user')) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 1, login: 'ada', email: null }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([{ email: 'ada@example.com', primary: true, verified: true }]),
          { status: 200 },
        ),
      );
    };

    await expect(
      readGitHubOAuthProfile({
        accessToken: 'token',
        userUrl: 'https://api.github.com/user',
        emailsUrl: 'https://api.github.com/user/emails',
        fetchImpl,
      }),
    ).resolves.toEqual(expect.objectContaining({ email: 'ada@example.com', email_verified: true }));
  });
});

describe('planOAuthCreateUserEmail', () => {
  it('stamps verified OAuth signups and skips the verification email', () => {
    expect(
      planOAuthCreateUserEmail({
        kind: 'new',
        emailVerifiedByProvider: true,
        alreadyVerified: false,
      }),
    ).toEqual({ stampVerified: true, sendVerificationEmail: false });
    expect(
      planOAuthCreateUserEmail({
        kind: 'new',
        emailVerifiedByProvider: false,
        alreadyVerified: false,
      }),
    ).toEqual({ stampVerified: false, sendVerificationEmail: true });
  });

  it('does not unverify a linked Timeline account or send another token email', () => {
    expect(
      planOAuthCreateUserEmail({
        kind: 'link',
        emailVerifiedByProvider: true,
        alreadyVerified: true,
      }),
    ).toEqual({ stampVerified: false, sendVerificationEmail: false });
    expect(
      planOAuthCreateUserEmail({
        kind: 'link',
        emailVerifiedByProvider: true,
        alreadyVerified: false,
      }),
    ).toEqual({ stampVerified: true, sendVerificationEmail: false });
  });

  it('leaves credentials-style unverified signups on the token path', () => {
    expect(oauthCreateUserAlreadyVerified({ emailVerified: null })).toBe(false);
    expect(oauthCreateUserAlreadyVerified({ emailVerified: new Date() })).toBe(true);
    expect(oauthProviderAssertsVerifiedEmail({ provider: 'credentials' })).toBe(false);
    expect(
      planOAuthCreateUserEmail({
        kind: null,
        emailVerifiedByProvider: false,
        alreadyVerified: false,
      }),
    ).toEqual({ stampVerified: false, sendVerificationEmail: true });
  });
});

describe('decideOAuthSignIn', () => {
  it('matches GitHub publication-blocked behavior for new and existing accounts', () => {
    expect(
      decideOAuthSignIn({
        provider: 'github',
        alreadyLinked: false,
        legalPublicationReady: false,
      }),
    ).toBe(false);
    expect(
      decideOAuthSignIn({
        provider: 'github',
        alreadyLinked: true,
        legalPublicationReady: false,
      }),
    ).toBe(true);
    expect(
      decideOAuthSignIn({
        provider: 'github',
        alreadyLinked: false,
        legalPublicationReady: true,
      }),
    ).toBe(true);
  });

  it('creates a Google workspace only when publication is open and the email is verified', () => {
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: true,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: null,
      }),
    ).toBe(true);
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: false,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: null,
      }),
    ).toBe(false);
  });

  it('never auto-links unverified Google or Timeline emails', () => {
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: true,
        hasEmail: true,
        googleEmailVerified: false,
        existingEmailOwnerVerified: true,
      }),
    ).toBe(false);
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: true,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: false,
      }),
    ).toBe(false);
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: true,
        hasEmail: false,
        googleEmailVerified: true,
        existingEmailOwnerVerified: null,
      }),
    ).toBe(false);
  });

  it('links by verified email and still signs in an already-linked Google account', () => {
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: false,
        legalPublicationReady: true,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: true,
      }),
    ).toBe(true);
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: true,
        legalPublicationReady: false,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: false,
      }),
    ).toBe(true);
    expect(
      decideOAuthSignIn({
        provider: 'google',
        alreadyLinked: true,
        legalPublicationReady: true,
        hasEmail: true,
        googleEmailVerified: true,
        existingEmailOwnerVerified: false,
      }),
    ).toBe(true);
  });

  it('leaves credentials and other providers unchanged', () => {
    expect(
      decideOAuthSignIn({
        provider: 'credentials',
        alreadyLinked: false,
        legalPublicationReady: false,
      }),
    ).toBe(true);
  });
});

describe('pending OAuth registration source', () => {
  it('records and consumes provider plus new-versus-link kind by email', () => {
    rememberOAuthRegistration('Ada@Example.com', 'google', 'new', true);
    expect(takeOAuthRegistration('ada@example.com')).toEqual({
      provider: 'google',
      kind: 'new',
      emailVerifiedByProvider: true,
    });
    expect(takeOAuthRegistration('ada@example.com')).toBeNull();

    rememberOAuthRegistration('owner@example.com', 'google', 'link', true);
    expect(takeOAuthRegistration('owner@example.com')).toEqual({
      provider: 'google',
      kind: 'link',
      emailVerifiedByProvider: true,
    });
  });
});

describe('authenticationMethod', () => {
  it('maps Auth.js providers onto the analytics method enum', () => {
    expect(authenticationMethod('google')).toBe('google');
    expect(authenticationMethod('github')).toBe('github');
    expect(authenticationMethod('credentials')).toBe('credentials');
    expect(authenticationMethod(undefined)).toBe('credentials');
  });
});

describe('oauthSignInErrorMessage', () => {
  it('explains linking denials without confirming whether an account exists', () => {
    expect(oauthSignInErrorMessage('OAuthAccountNotLinked')).toMatch(/verify/i);
    expect(oauthSignInErrorMessage('AccessDenied')).toMatch(/never linked automatically/i);
    expect(oauthSignInErrorMessage('OAuthCallback')).toMatch(/cancelled/i);
    expect(oauthSignInErrorMessage(undefined)).toBeNull();
    expect(oauthSignInErrorMessage('Configuration')).toBeNull();
  });
});
