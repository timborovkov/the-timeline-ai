import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { select: vi.fn() } }));

const { activeTeamCookieOptions } = await import('@/lib/active-team');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('active-team cookie privacy options', () => {
  it('is host-only, HttpOnly, and Secure in hosted production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(activeTeamCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    expect(activeTeamCookieOptions()).not.toHaveProperty('domain');
  });

  it('allows the cookie over localhost HTTP outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(activeTeamCookieOptions().secure).toBe(false);
  });
});
