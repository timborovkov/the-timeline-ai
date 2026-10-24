import type { NextResponse } from 'next/server';

export const ACTIVE_TEAM_COOKIE = 'tl_active_team';
const ACTIVE_TEAM_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ACTIVE_TEAM_COOKIE_VERSION_PREFIX = 'v2:';
const TEAM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ParsedActiveTeamCookie {
  teamId: string;
  needsMigration: boolean;
}

export function parseActiveTeamCookie(value: string | undefined): ParsedActiveTeamCookie | null {
  if (!value) return null;
  const needsMigration = !value.startsWith(ACTIVE_TEAM_COOKIE_VERSION_PREFIX);
  const candidate = needsMigration ? value : value.slice(ACTIVE_TEAM_COOKIE_VERSION_PREFIX.length);
  if (!TEAM_ID_PATTERN.test(candidate)) return null;
  return { teamId: candidate.toLowerCase(), needsMigration };
}

export function serializeActiveTeamCookie(teamId: string): string {
  if (!TEAM_ID_PATTERN.test(teamId)) throw new Error('Active team cookie requires a UUID');
  return `${ACTIVE_TEAM_COOKIE_VERSION_PREFIX}${teamId.toLowerCase()}`;
}

/**
 * Keep the active workspace preference no longer than the default Auth.js
 * session and never allow production traffic to send it over plain HTTP.
 *
 * The cookie must remain available to `/api` and Server Action requests because
 * those routes resolve the active team independently of the `/app` layout.
 */
export function activeTeamCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACTIVE_TEAM_COOKIE_MAX_AGE_SECONDS,
  };
}

export function shouldExpireUnverifiedActiveTeamCookie(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = parseActiveTeamCookie(value);
  return !parsed || parsed.needsMigration;
}

export function expireActiveTeamCookie(response: NextResponse): void {
  response.cookies.set(ACTIVE_TEAM_COOKIE, '', {
    ...activeTeamCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
}
