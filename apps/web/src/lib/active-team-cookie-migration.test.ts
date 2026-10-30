import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type * as ActiveTeamModule from '@/lib/active-team';
import type { NextResponse as NextResponseType } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
type NextResponse = NextResponseType;

const fakes = vi.hoisted(() => ({ verifyMembership: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { select: vi.fn() } }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  async (importOriginal) => {
    const actual = await importOriginal<typeof ActiveTeamModule>();
    return { ...actual, verifyMembership: fakes.verifyMembership };
  },
  () => import('@/lib/active-team'),
);

const { NextRequest, NextResponse } = await import('next/server');
const { ACTIVE_TEAM_COOKIE } = await import('@/lib/active-team');
const { migrateLegacyActiveTeamCookie } = await import('@/lib/active-team-cookie-migration');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function request(cookieValue: string | undefined, authenticated = true): NextAuthRequest {
  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${ACTIVE_TEAM_COOKIE}=${cookieValue}`);
  const result = new NextRequest('https://thetimeline.cc/', { headers });
  Object.defineProperty(result, 'auth', {
    value: authenticated ? { user: { id: USER_ID } } : null,
  });
  return result as NextAuthRequest;
}

function expectExpired(response: NextResponse): void {
  const setCookie = response.headers.get('set-cookie');
  expect(setCookie).toContain(`${ACTIVE_TEAM_COOKIE}=`);
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Secure');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain('Max-Age=0');
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  fakes.verifyMembership.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('legacy active-team cookie migration', () => {
  it('reissues a verified legacy team once with the current privacy attributes', async () => {
    const response = NextResponse.next();

    await migrateLegacyActiveTeamCookie(request(TEAM_ID), response);

    expect(fakes.verifyMembership).toHaveBeenCalledWith(USER_ID, TEAM_ID);
    expect(response.cookies.get(ACTIVE_TEAM_COOKIE)?.value).toBe(`v2:${TEAM_ID}`);
    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=2592000');
  });

  it('does not query or slide a current v2 cookie', async () => {
    const response = NextResponse.next();

    await migrateLegacyActiveTeamCookie(request(`v2:${TEAM_ID}`), response);

    expect(fakes.verifyMembership).not.toHaveBeenCalled();
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('does not trust malformed or unauthenticated legacy values', async () => {
    const malformedResponse = NextResponse.next();
    const malformedVersionedResponse = NextResponse.next();
    const unauthenticatedResponse = NextResponse.next();

    await migrateLegacyActiveTeamCookie(request('not-a-team'), malformedResponse);
    await migrateLegacyActiveTeamCookie(request('v2:not-a-team'), malformedVersionedResponse);
    await migrateLegacyActiveTeamCookie(request(TEAM_ID, false), unauthenticatedResponse);

    expect(fakes.verifyMembership).not.toHaveBeenCalled();
    expectExpired(malformedResponse);
    expectExpired(malformedVersionedResponse);
    expectExpired(unauthenticatedResponse);
  });

  it('does not reissue a legacy team outside the authenticated user membership', async () => {
    fakes.verifyMembership.mockResolvedValue(false);
    const response = NextResponse.next();

    await migrateLegacyActiveTeamCookie(request(TEAM_ID), response);

    expect(fakes.verifyMembership).toHaveBeenCalledWith(USER_ID, TEAM_ID);
    expectExpired(response);
  });

  it('keeps migration failure from blocking the response', async () => {
    fakes.verifyMembership.mockRejectedValue(new Error('database unavailable'));
    const response = NextResponse.next();

    await expect(
      migrateLegacyActiveTeamCookie(request(TEAM_ID), response),
    ).resolves.toBeUndefined();

    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
