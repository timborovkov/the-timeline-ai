import { nonEmptyEnv } from '@/lib/safe-redirect';

export const GOOGLE_SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

export type OAuthSignInProvider = 'github' | 'google';
export type OAuthRegistrationKind = 'new' | 'link';

const pendingOAuthRegistrations = new Map<
  string,
  { provider: OAuthSignInProvider; kind: OAuthRegistrationKind }
>();

export function oauthClientConfigured(
  clientId: string | undefined,
  clientSecret: string | undefined,
): boolean {
  return Boolean(nonEmptyEnv(clientId) && nonEmptyEnv(clientSecret));
}

export function googleSignInAuthorizationParams(): {
  scope: string;
  include_granted_scopes: 'false';
} {
  return {
    scope: GOOGLE_SIGN_IN_SCOPES.join(' '),
    // The Drive connection uses this same OAuth client. Never inherit those
    // scopes onto the sign-in token.
    include_granted_scopes: 'false',
  };
}

export function googleSignInScopeList(scope: string | null | undefined): string[] {
  return (scope ?? '').split(/[+\s]/).filter(Boolean);
}

export function googleSignInRequestsDriveAccess(scope: string | null | undefined): boolean {
  return googleSignInScopeList(scope).some((value) => value.toLowerCase().includes('drive'));
}

export function isGoogleEmailVerified(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  return 'email_verified' in profile && profile.email_verified === true;
}

export function decideOAuthSignIn(input: {
  provider: string;
  alreadyLinked: boolean;
  legalPublicationReady: boolean;
  hasEmail?: boolean;
  googleEmailVerified?: boolean;
  existingEmailOwnerVerified?: boolean | null;
}): boolean {
  if (input.provider !== 'github' && input.provider !== 'google') return true;

  if (!input.legalPublicationReady) return input.alreadyLinked;

  if (input.provider === 'google') {
    if (input.hasEmail === false) return false;
    if (input.googleEmailVerified !== true) return false;
    if (!input.alreadyLinked && input.existingEmailOwnerVerified === false) return false;
  }

  return true;
}

export function rememberOAuthRegistration(
  email: string | null | undefined,
  provider: OAuthSignInProvider,
  kind: OAuthRegistrationKind,
): void {
  const key = email?.trim().toLowerCase();
  if (!key) return;
  pendingOAuthRegistrations.set(key, { provider, kind });
}

export function takeOAuthRegistration(
  email: string | null | undefined,
): { provider: OAuthSignInProvider; kind: OAuthRegistrationKind } | null {
  const key = email?.trim().toLowerCase();
  if (!key) return null;
  const pending = pendingOAuthRegistrations.get(key) ?? null;
  if (pending) pendingOAuthRegistrations.delete(key);
  return pending;
}

export function authenticationMethod(
  provider: string | null | undefined,
): 'credentials' | 'github' | 'google' {
  if (provider === 'github' || provider === 'google') return provider;
  return 'credentials';
}

export function oauthSignInErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  if (error === 'OAuthAccountNotLinked' || error === 'AccessDenied') {
    return 'This sign-in method could not be linked. Use your existing email or GitHub login, verify that email, then try again. Unverified emails are never linked automatically.';
  }
  if (
    error === 'OAuthCallback' ||
    error === 'OAuthSignin' ||
    error === 'OAuthCreateAccount' ||
    error === 'Callback'
  ) {
    return 'Sign-in was cancelled or could not be completed. Try again.';
  }
  return null;
}
