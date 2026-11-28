import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeCookies: vi.fn(),
  fakeVerifyMembership: vi.fn(),
  cookieSet: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.fakeAuth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => {
    return {
      ACTIVE_TEAM_COOKIE: 'tl_active_team',
      activeTeamCookieOptions: () => ({ httpOnly: true, path: '/', secure: true }),
      serializeActiveTeamCookie: (teamId: string) => `v2:${teamId}`,
      verifyMembership: fakes.fakeVerifyMembership,
    };
  },
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ cookies: fakes.fakeCookies }),
  () => import('next/headers'),
);

const { POST } = await import('@/app/app/team/switch/[teamId]/route');
const { ACTIVE_TEAM_COOKIE } = await import('@/lib/active-team');

const ENV_BACKUP = { ...process.env };
const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function internalRequest(): Request {
  return new Request(`https://0.0.0.0:8080/app/team/switch/${TEAM_ID}`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ENV_BACKUP, AUTH_URL: 'https://thetimeline.cc' };
  fakes.fakeAuth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.fakeVerifyMembership.mockResolvedValue(true);
  fakes.fakeCookies.mockResolvedValue({ set: fakes.cookieSet });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('team switch route', () => {
  it('redirects to the public app origin after switching teams', async () => {
    const response = await POST(internalRequest(), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });

    expect(fakes.cookieSet).toHaveBeenCalledWith(
      ACTIVE_TEAM_COOKIE,
      `v2:${TEAM_ID}`,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(response.headers.get('location')).toBe('https://thetimeline.cc/app');
  });

  it('allows a same-origin update destination only after membership is verified', async () => {
    const request = (target: string) =>
      new Request(`${internalRequest().url}?${new URLSearchParams({ update: target })}`, {
        method: 'POST',
      });
    const params = { params: Promise.resolve({ teamId: TEAM_ID }) };
    const allowed = await POST(request('/app/timeline?event=launch#ev-launch'), params);
    expect(allowed.status).toBe(303);
    expect(allowed.headers.get('location')).toBe(
      'https://thetimeline.cc/app/timeline?event=launch#ev-launch',
    );
    const blocked = await POST(request('https://other.example/app/timeline'), params);
    expect(blocked.headers.get('location')).toBe('https://thetimeline.cc/app');
    fakes.fakeVerifyMembership.mockResolvedValue(false);
    const denied = await POST(request('/app/timeline?event=launch'), params);
    expect(denied.headers.get('location')).toBe('https://thetimeline.cc/app');
  });

  it('opens the requested update after an authorized workspace switch', async () => {
    const digestId = '33333333-3333-4333-8333-333333333333';
    const url = new URL(internalRequest().url);
    url.searchParams.set('digest', digestId);
    const response = await POST(new Request(url, { method: 'POST' }), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `https://thetimeline.cc/app/digests?digest=${digestId}`,
    );
    expect(fakes.cookieSet).toHaveBeenCalledOnce();
  });

  it('does not inherit the internal request origin for auth redirects', async () => {
    fakes.fakeAuth.mockResolvedValue(null);

    const response = await POST(internalRequest(), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });

    expect(response.headers.get('location')).toBe('https://thetimeline.cc/sign-in');
  });

  it('does not inherit the internal request origin when membership fails', async () => {
    fakes.fakeVerifyMembership.mockResolvedValue(false);

    const response = await POST(internalRequest(), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });

    expect(response.headers.get('location')).toBe('https://thetimeline.cc/app');
  });

  it('redirects to /app without setting the cookie when the workspace is suspended', async () => {
    const { PlatformAccessError } = await import('@timeline/shared/platform-admin');
    fakes.fakeVerifyMembership.mockRejectedValue(new PlatformAccessError('Workspace is suspended'));

    const response = await POST(internalRequest(), {
      params: Promise.resolve({ teamId: TEAM_ID }),
    });

    expect(fakes.cookieSet).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://thetimeline.cc/app');
  });

  it('rethrows unexpected membership errors', async () => {
    fakes.fakeVerifyMembership.mockRejectedValue(new Error('database unavailable'));

    await expect(
      POST(internalRequest(), {
        params: Promise.resolve({ teamId: TEAM_ID }),
      }),
    ).rejects.toThrow('database unavailable');
    expect(fakes.cookieSet).not.toHaveBeenCalled();
  });
});
