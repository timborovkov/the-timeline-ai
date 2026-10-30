import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type { NextRequest as NextRequestType } from 'next/server';
import type { NextFetchEvent } from 'next/server';
type NextRequest = NextRequestType;

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capture: vi.fn().mockResolvedValue(undefined),
  migrateActiveTeamCookie: vi
    .fn<(request: NextRequest, response: Response) => Promise<void>>()
    .mockResolvedValue(undefined),
  wrappedAuthMiddleware: undefined as
    ((request: NextRequest, event: NextFetchEvent) => Promise<Response>) | undefined,
}));

await vi.mock(
  import.meta.resolve('next-auth'),
  () => ({
    default: () => ({
      auth: (middleware: (request: NextRequest, event: NextFetchEvent) => Promise<Response>) => {
        mocks.wrappedAuthMiddleware = middleware;
        return mocks.auth;
      },
    }),
  }),
  () => import('next-auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team-cookie-migration'),
  () => ({
    migrateLegacyActiveTeamCookie: mocks.migrateActiveTeamCookie,
  }),
  () => import('@/lib/active-team-cookie-migration'),
);
await vi.mock(
  import.meta.resolve('@/lib/auth.config'),
  () => ({ authConfig: {} }),
  () => import('@/lib/auth.config'),
);
await vi.mock(
  import.meta.resolve('@/lib/canonical-host'),
  () => ({ canonicalHostRedirect: () => null }),
  () => import('@/lib/canonical-host'),
);
await vi.mock(
  import.meta.resolve('@/lib/multipart-request'),
  () => ({ rejectInvalidMultipartRequest: () => null }),
  () => import('@/lib/multipart-request'),
);
await vi.mock(
  import.meta.resolve('@/lib/analytics'),
  () => ({ capturePersonlessSurfaceRequest: mocks.capture }),
  () => import('@/lib/analytics'),
);

const { NextRequest } = await import('next/server');
const { proxy } = await import('@/proxy');

function request(path: string) {
  return new NextRequest(`https://thetimeline.cc${path}`, {
    headers: { accept: 'text/html' },
  });
}

function context() {
  const waitUntil = vi.fn();
  return {
    event: { waitUntil } as unknown as NextFetchEvent,
    waitUntil,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy personless app-surface integration', () => {
  it.each([
    ['an authentication redirect', Response.redirect('https://thetimeline.cc/sign-in')],
    ['a stale-auth failure', new Response(null, { status: 428 })],
  ])('does not count app requests rejected by Auth.js as %s', async (_label, authResponse) => {
    mocks.auth.mockResolvedValue(authResponse);
    const { event, waitUntil } = context();

    const response = await proxy(request('/app/timeline'), event);

    expect(response).toBe(authResponse);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('counts an app surface only after Auth.js permits the request', async () => {
    const authResponse = new Response(null, { status: 200 });
    mocks.auth.mockResolvedValue(authResponse);
    const { event, waitUntil } = context();

    const response = await proxy(request('/app/timeline'), event);

    expect(response).toBe(authResponse);
    expect(mocks.capture).toHaveBeenCalledWith('app', 'timeline');
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('registers the active-team migration inside the Auth.js-permitted response callback', async () => {
    const { event } = context();
    const wrapped = mocks.wrappedAuthMiddleware;
    if (!wrapped) throw new Error('expected wrapped Auth.js middleware');

    const response = await wrapped(request('/'), event);

    expect(mocks.migrateActiveTeamCookie).toHaveBeenCalledOnce();
    expect(mocks.migrateActiveTeamCookie.mock.calls[0]?.[0]).toBeInstanceOf(NextRequest);
    expect(mocks.migrateActiveTeamCookie.mock.calls[0]?.[1]).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
  });
});
