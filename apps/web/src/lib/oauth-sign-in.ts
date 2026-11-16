import { nonEmptyEnv } from '@/lib/safe-redirect';

export const GOOGLE_SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

type OAuthSignInProvider = 'github' | 'google';
export type OAuthRegistrationKind = 'new' | 'link';

interface GitHubAccountEmail {
  email: string;
  primary?: boolean;
  verified?: boolean;
}

interface OAuthRegistration {
  provider: OAuthSignInProvider;
  kind: OAuthRegistrationKind;
  emailVerifiedByProvider: boolean;
}

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
  // `\s` is the whitespace class. `/[+\\s]/` would match `+`, `\`, or `s`.
  return (scope ?? '').split(/[\s+]/).filter(Boolean);
}

export function googleSignInRequestsDriveAccess(scope: string | null | undefined): boolean {
  return googleSignInScopeList(scope).some((value) => value.toLowerCase().includes('drive'));
}

export function isGoogleEmailVerified(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  return 'email_verified' in profile && profile.email_verified === true;
}

export function isGitHubEmailVerified(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  return 'email_verified' in profile && profile.email_verified === true;
}

function asGitHubAccountEmail(row: unknown): GitHubAccountEmail | null {
  if (!row || typeof row !== 'object' || !('email' in row) || typeof row.email !== 'string') {
    return null;
  }
  return {
    email: row.email,
    primary: 'primary' in row && row.primary === true,
    verified: 'verified' in row && row.verified === true,
  };
}

export function selectGitHubAccountEmail(
  emails: unknown,
): { email: string; verified: true } | null {
  if (!Array.isArray(emails)) return null;
  const usable = emails
    .map(asGitHubAccountEmail)
    .filter((row): row is GitHubAccountEmail & { verified: true } =>
      Boolean(row?.verified && row.email.includes('@')),
    );
  const chosen = usable.find((row) => row.primary === true) ?? usable[0];
  return chosen ? { email: chosen.email, verified: true } : null;
}

export async function readGitHubOAuthProfile(input: {
  accessToken: string;
  userUrl?: string;
  emailsUrl?: string;
  fetchImpl?: (url: string, init?: { headers: Record<string, string> }) => Promise<Response>;
}): Promise<Record<string, unknown>> {
  const fetchImpl =
    input.fetchImpl ??
    ((url: string, init?: { headers: Record<string, string> }) => fetch(url, init));
  const headers = {
    Authorization: `Bearer ${input.accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'authjs',
  };
  const profileResponse = await fetchImpl(input.userUrl ?? 'https://api.github.com/user', {
    headers,
  });
  const profile = (await profileResponse.json()) as Record<string, unknown>;
  const emailsRes = await fetchImpl(input.emailsUrl ?? 'https://api.github.com/user/emails', {
    headers,
  });
  if (emailsRes.ok) {
    const selected = selectGitHubAccountEmail(await emailsRes.json());
    if (selected) {
      profile.email = selected.email;
      profile.email_verified = true;
      return profile;
    }
  }
  profile.email_verified = false;
  return profile;
}

export function oauthProviderAssertsVerifiedEmail(input: {
  provider: string;
  googleEmailVerified?: boolean;
  githubEmailVerified?: boolean;
}): boolean {
  if (input.provider === 'google') return input.googleEmailVerified === true;
  if (input.provider === 'github') return input.githubEmailVerified === true;
  return false;
}

export function oauthCreateUserAlreadyVerified(user: unknown): boolean {
  if (!user || typeof user !== 'object' || !('emailVerified' in user)) return false;
  return Boolean(user.emailVerified);
}

export function planOAuthCreateUserEmail(input: {
  kind: OAuthRegistrationKind | null;
  emailVerifiedByProvider: boolean;
  alreadyVerified: boolean;
}): { stampVerified: boolean; sendVerificationEmail: boolean } {
  if (input.alreadyVerified) {
    return { stampVerified: false, sendVerificationEmail: false };
  }
  if (input.kind === 'link') {
    return {
      stampVerified: input.emailVerifiedByProvider,
      sendVerificationEmail: false,
    };
  }
  if (input.emailVerifiedByProvider) {
    return { stampVerified: true, sendVerificationEmail: false };
  }
  return { stampVerified: false, sendVerificationEmail: true };
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

/** One Auth.js invocation owns the signIn → createUser handoff. */
export function createOAuthRegistrationAttempt() {
  let approved: { email: string; registration: OAuthRegistration } | null = null;
  return {
    approve(input: OAuthRegistration & { email: string | null | undefined }): void {
      const email = input.email?.trim().toLowerCase();
      approved = email
        ? {
            email,
            registration: {
              provider: input.provider,
              kind: input.kind,
              emailVerifiedByProvider: input.emailVerifiedByProvider,
            },
          }
        : null;
    },
    consume(email: string | null | undefined): OAuthRegistration | null {
      const current = approved;
      approved = null;
      return current && current.email === email?.trim().toLowerCase() ? current.registration : null;
    },
  };
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
