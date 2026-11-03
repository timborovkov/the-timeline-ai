import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as DbModule from '@timeline/db';
import type { NextFetchEvent } from 'next/server';
const mocks = vi.hoisted(() => ({
  migrateActiveTeamCookie: vi.fn().mockResolvedValue(undefined),
  scheduleSurfaceRequest: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/active-team-cookie-migration'),
  () => ({
    migrateLegacyActiveTeamCookie: mocks.migrateActiveTeamCookie,
  }),
  () => import('@/lib/active-team-cookie-migration'),
);
await vi.mock(
  import.meta.resolve('@/lib/surface-request-analytics'),
  () => ({
    schedulePersonlessSurfaceRequest: mocks.scheduleSurfaceRequest,
  }),
  () => import('@/lib/surface-request-analytics'),
);

const versionRow = vi.fn().mockResolvedValue([{ version: 0 }]);
await vi.mock(
  import.meta.resolve('@timeline/db'),
  async (original) => ({
    ...(await original<typeof DbModule>()),
    getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: versionRow }) }) }) }),
  }),
  () => import('@timeline/db'),
);
const { encode } = await import('next-auth/jwt');
const { NextRequest } = await import('next/server');
const { proxy } = await import('@/proxy');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

function context(): NextFetchEvent {
  return {
    passThroughOnException: vi.fn(),
    waitUntil: vi.fn(),
  } as unknown as NextFetchEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy with installed Auth.js', () => {
  it('redirects an unauthenticated app request before active-team migration', async () => {
    const request = new NextRequest('https://timeline.test/app/timeline?view=all', {
      headers: {
        accept: 'text/html',
        cookie: `tl_active_team=${TEAM_ID}`,
      },
    });

    const response = await proxy(request, context());

    expect(response?.status).toBe(307);
    expect(response?.headers.get('location')).toBe(
      'https://timeline.test/sign-in?callbackUrl=https%3A%2F%2Ftimeline.test%2Fapp%2Ftimeline%3Fview%3Dall',
    );
    expect(response?.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.migrateActiveTeamCookie).not.toHaveBeenCalled();
  });
});

it('rejects a revoked JWT in the real proxy and Auth.js session endpoint', async () => {
  const cookieName = '__Secure-authjs.session-token';
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('Test auth secret is required');
  const jwt = await encode({
    token: { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionVersion: 0 },
    secret,
    salt: cookieName,
  });
  versionRow.mockResolvedValue([{ version: 1 }]);
  const request = new NextRequest('https://timeline.test/app/timeline', {
    headers: { cookie: `${cookieName}=${jwt}` },
  });
  const response = await proxy(request, context());
  expect(response?.status).toBe(307);
  expect(response?.headers.get('location')).toContain('/sign-in');
  expect(mocks.migrateActiveTeamCookie).not.toHaveBeenCalled();
  const { default: NextAuth } = await import('next-auth');
  const { authConfig } = await import('@/lib/auth.config');
  const handler = NextAuth(authConfig).handlers.GET;
  const sessionResponse = await handler(
    new NextRequest('https://timeline.test/api/auth/session', {
      headers: { cookie: `${cookieName}=${jwt}` },
    }),
  );
  expect(await sessionResponse.json()).toBeNull();
});
