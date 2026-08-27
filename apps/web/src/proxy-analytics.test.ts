import { NextRequest, type NextFetchEvent } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capture: vi.fn().mockResolvedValue(undefined),
  migrateActiveTeamCookie: vi
    .fn<(request: NextRequest, response: Response) => Promise<void>>()
    .mockResolvedValue(undefined),
  wrappedAuthMiddleware: undefined as
    | ((request: NextRequest, event: NextFetchEvent) => Promise<Response>)
    | undefined,
}));

vi.mock('next-auth', () => ({
  default: () => ({
    auth: (middleware: (request: NextRequest, event: NextFetchEvent) => Promise<Response>) => {
      mocks.wrappedAuthMiddleware = middleware;
      return mocks.auth;
    },
  }),
}));
vi.mock('@/lib/active-team-cookie-migration', () => ({
  migrateLegacyActiveTeamCookie: mocks.migrateActiveTeamCookie,
}));
vi.mock('@/lib/auth.config', () => ({ authConfig: {} }));
vi.mock('@/lib/canonical-host', () => ({ canonicalHostRedirect: () => null }));
vi.mock('@/lib/multipart-request', () => ({ rejectInvalidMultipartRequest: () => null }));
vi.mock('@/lib/analytics', () => ({ capturePersonlessSurfaceRequest: mocks.capture }));

import { proxy } from '@/proxy';

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

beforeEach(() => vi.clearAllMocks());

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
