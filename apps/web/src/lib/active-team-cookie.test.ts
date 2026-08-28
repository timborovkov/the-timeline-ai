import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeTeamCookieOptions,
  parseActiveTeamCookie,
  serializeActiveTeamCookie,
} from '@/lib/active-team-cookie';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

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

  it('accepts current and legacy UUID values without accepting arbitrary input', () => {
    expect(parseActiveTeamCookie(`v2:${TEAM_ID}`)).toEqual({
      teamId: TEAM_ID,
      needsMigration: false,
    });
    expect(parseActiveTeamCookie(TEAM_ID.toUpperCase())).toEqual({
      teamId: TEAM_ID,
      needsMigration: true,
    });
    expect(parseActiveTeamCookie('v2:not-a-team')).toBeNull();
    expect(parseActiveTeamCookie('not-a-team')).toBeNull();
  });

  it('serializes only valid team UUIDs into the current value format', () => {
    expect(serializeActiveTeamCookie(TEAM_ID)).toBe(`v2:${TEAM_ID}`);
    expect(() => serializeActiveTeamCookie('not-a-team')).toThrow(
      'Active team cookie requires a UUID',
    );
  });
});
