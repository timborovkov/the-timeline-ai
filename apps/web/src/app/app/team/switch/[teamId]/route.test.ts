import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/app/team/switch/[teamId]/route';
import { ACTIVE_TEAM_COOKIE } from '@/lib/active-team';

const fakes = vi.hoisted(() => ({
  fakeAuth: vi.fn(),
  fakeCookies: vi.fn(),
  fakeVerifyMembership: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.fakeAuth }));
vi.mock('@/lib/active-team', () => {
  return { ACTIVE_TEAM_COOKIE: 'tl_active_team', verifyMembership: fakes.fakeVerifyMembership };
});
vi.mock('next/headers', () => ({ cookies: fakes.fakeCookies }));

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
      TEAM_ID,
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(response.headers.get('location')).toBe('https://thetimeline.cc/app');
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
});
