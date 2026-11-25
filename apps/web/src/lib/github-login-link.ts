import { accounts, users, type Db } from '@timeline/db';
import { IMPERSONATION_COOKIE } from '@timeline/shared/platform-admin';
import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { decode, encode, getToken } from 'next-auth/jwt';

import { ACCOUNT_SETTINGS_PATH } from '@/lib/auth-redirect';
import { authConfig } from '@/lib/auth.config';
import { hasCurrentLegalAcceptance } from '@/lib/legal';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { nonEmptyEnv } from '@/lib/safe-redirect';

export const GITHUB_LINK_RETURN = `${ACCOUNT_SETTINGS_PATH}?github=linking`;
export const GITHUB_LINK_FAILED = `${ACCOUNT_SETTINGS_PATH}?github=failed`;
const INTENT_NAME = 'timeline.github-login-link';
const INTENT_MAX_AGE = 15 * 60;

function intentCookie(secure: boolean) {
  return secure ? `__Host-${INTENT_NAME}` : INTENT_NAME;
}

export async function createGitHubLinkCookie(destination: URL, userId: string) {
  const state = destination.searchParams.get('state');
  const callback = destination.searchParams.get('redirect_uri');
  const secret = authConfig.secret;
  if (destination.origin !== 'https://github.com' || !state || !callback || !secret) return null;

  const secure = new URL(callback).protocol === 'https:';
  const name = intentCookie(secure);
  const value = await encode({
    token: { sub: userId, state },
    secret,
    salt: name,
    maxAge: INTENT_MAX_AGE,
  });
  return {
    name,
    value,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: INTENT_MAX_AGE,
  };
}

export function githubAuthUrl(request: NextRequest): URL {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return new URL(nonEmptyEnv(configured) ?? request.url);
}

export function isGitHubCallback(request: NextRequest): boolean {
  return request.nextUrl.pathname === '/api/auth/callback/github';
}

/** The return URL marks the flow even if its intent cookie is missing or expired. */
export function hasGitHubLinkReturn(request: NextRequest): boolean {
  const url = githubAuthUrl(request);
  const prefix = url.protocol === 'https:' ? '__Secure-' : '';
  const callback = request.cookies.get(`${prefix}authjs.callback-url`)?.value;
  return callback === `${url.origin}${GITHUB_LINK_RETURN}`;
}

export async function readGitHubLinkIntent(request: NextRequest): Promise<string | null> {
  const name = intentCookie(githubAuthUrl(request).protocol === 'https:');
  const token = request.cookies.get(name)?.value;
  const states = request.nextUrl.searchParams.getAll('state');
  const secret = authConfig.secret;
  if (request.method !== 'GET' || !token || states.length !== 1 || !secret) return null;
  try {
    const intent = await decode({ token, secret, salt: name });
    return intent && intent.state === states[0] ? (intent.sub ?? null) : null;
  } catch {
    return null;
  }
}

export async function readGitHubCallbackSession(request: NextRequest) {
  const secret = authConfig.secret;
  if (!secret) return null;
  // getToken also accepts bearer credentials. Linking requires the browser's session cookie.
  const headers = new Headers({ cookie: request.headers.get('cookie') ?? '' });
  return getToken({
    req: { headers },
    secret,
    secureCookie: githubAuthUrl(request).protocol === 'https:',
  });
}

export async function finishGitHubLoginLink(
  db: Db,
  request: NextRequest,
  userId: string | null,
  providerAccountId: string,
): Promise<string> {
  if (!userId || request.cookies.has(IMPERSONATION_COOKIE) || !isLegalPublicationReady()) {
    return GITHUB_LINK_FAILED;
  }
  const session = await readGitHubCallbackSession(request);
  if (session?.sub !== userId) return GITHUB_LINK_FAILED;

  const linked = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        sessionVersion: users.sessionVersion,
        suspendedAt: users.suspendedAt,
        legalTermsVersion: users.legalTermsVersion,
        legalPrivacyVersion: users.legalPrivacyVersion,
        legalAcceptedAt: users.legalAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (
      !user ||
      user.suspendedAt ||
      user.sessionVersion !== (session.sessionVersion ?? 0) ||
      !hasCurrentLegalAcceptance(user)
    ) {
      return false;
    }

    const [existing] = await tx
      .select({ providerAccountId: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'github')))
      .limit(1);
    if (existing) return existing.providerAccountId === providerAccountId;

    // Only the stable provider identity is needed for future sign-ins.
    const [inserted] = await tx
      .insert(accounts)
      .values({ userId, provider: 'github', type: 'oauth', providerAccountId })
      .onConflictDoNothing()
      .returning({ userId: accounts.userId });
    return Boolean(inserted);
  });

  return linked ? ACCOUNT_SETTINGS_PATH : GITHUB_LINK_FAILED;
}
