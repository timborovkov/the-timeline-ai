import { NextResponse, type NextRequest } from 'next/server';

import type { NextAuthConfig, Session } from 'next-auth';

import {
  ACTIVE_TEAM_COOKIE,
  expireActiveTeamCookie,
  shouldExpireUnverifiedActiveTeamCookie,
} from '@/lib/active-team-cookie';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';
import { nonEmptyEnv } from '@/lib/safe-redirect';

const localAuthSecret =
  process.env.NODE_ENV === 'development'
    ? 'timeline-local-development-auth-secret-do-not-use-in-production'
    : undefined;
const authSecret =
  nonEmptyEnv(process.env.AUTH_SECRET) ??
  nonEmptyEnv(process.env.NEXTAUTH_SECRET) ??
  localAuthSecret;

const LEGAL_GATE_PATH = '/legal/accept';
const LEGAL_EXEMPT_API_PREFIXES = [
  '/api/auth',
  '/api/calendar/feed',
  '/api/cron',
  '/api/email/inbound',
  '/api/health',
  '/api/mcp/server',
  '/api/slack/commands',
  '/api/slack/events',
  '/api/slack/interactions',
  '/api/telegram/webhook',
  '/api/webhooks',
] as const;

export function hasCurrentLegalSession(
  user:
    | Pick<Session['user'], 'legalTermsVersion' | 'legalPrivacyVersion' | 'legalAcceptedAt'>
    | null
    | undefined,
): boolean {
  return (
    user?.legalTermsVersion === TERMS_VERSION &&
    user.legalPrivacyVersion === PRIVACY_VERSION &&
    Boolean(user.legalAcceptedAt)
  );
}

function isLegalExemptApi(path: string): boolean {
  return LEGAL_EXEMPT_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isRouteWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function legalReturnTo(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function legalGatePath(request: NextRequest): string {
  return `${LEGAL_GATE_PATH}?returnTo=${encodeURIComponent(legalReturnTo(request))}`;
}

function apiLegalGatePath(): string {
  return `${LEGAL_GATE_PATH}?returnTo=${encodeURIComponent('/app')}`;
}

function unauthenticatedAppRedirect(request: NextRequest): NextResponse {
  const signInUrl = new URL('/sign-in', request.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', request.nextUrl.href);
  const response = NextResponse.redirect(signInUrl);
  const activeTeamCookie = request.cookies.get(ACTIVE_TEAM_COOKIE)?.value;
  if (shouldExpireUnverifiedActiveTeamCookie(activeTeamCookie)) {
    expireActiveTeamCookie(response);
  }
  return response;
}

export function authorizeProductRequest({
  auth,
  request,
}: {
  auth: Session | null;
  request: NextRequest;
}): boolean | Response {
  const path = request.nextUrl.pathname;
  const isAuthed = Boolean(auth?.user);

  const isAppRoute = isRouteWithin(path, '/app');
  const isInviteRoute = isRouteWithin(path, '/accept-invite');

  if (isAppRoute && !isAuthed) return unauthenticatedAppRedirect(request);
  if (!isAuthed || !isLegalPublicationReady() || hasCurrentLegalSession(auth?.user)) return true;

  if (isAppRoute || isInviteRoute) {
    return Response.redirect(new URL(legalGatePath(request), request.nextUrl));
  }

  if (path.startsWith('/api/') && !isLegalExemptApi(path)) {
    return Response.json(
      {
        error: 'legal_acceptance_required',
        message: 'Accept the current Terms of Use and acknowledge the Privacy Policy.',
        acceptanceUrl: apiLegalGatePath(),
      },
      { status: 428, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return true;
}

/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * Lightweight auth config: providers + callbacks that do NOT need DB or
 * bcrypt. The proxy imports only this file; the full auth setup lives in
 * `auth.ts` and runs server-side.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: authSecret,
  pages: { signIn: '/sign-in' },
  session: { strategy: 'jwt' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
        session.user.legalTermsVersion = token.legalTermsVersion ?? null;
        session.user.legalPrivacyVersion = token.legalPrivacyVersion ?? null;
        session.user.legalAcceptedAt = token.legalAcceptedAt ?? null;
      }
      return session;
    },
    authorized: authorizeProductRequest,
  },
};
