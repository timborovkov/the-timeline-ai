import { afterEach, describe, expect, it } from 'vitest';

import { signedInAuthRedirect } from '@/lib/auth-redirect';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('signedInAuthRedirect', () => {
  it('sends explicit invite query tokens to accept-invite', () => {
    expect(signedInAuthRedirect({ inviteToken: 'invite 1' })).toBe('/accept-invite/invite%201');
  });

  it('keeps an accept-invite callback ahead of the pending invite cookie', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';

    expect(
      signedInAuthRedirect({
        callbackUrl: '/accept-invite/callback-token',
        pendingInviteToken: 'cookie-token',
      }),
    ).toBe('/accept-invite/callback-token');
  });

  it('uses a pending invite cookie before generic app callbacks', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';

    expect(
      signedInAuthRedirect({
        callbackUrl: '/app/timeline',
        pendingInviteToken: 'cookie-token',
      }),
    ).toBe('/accept-invite/cookie-token');
  });

  it('falls back to the sanitized callback without an invite', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';

    expect(signedInAuthRedirect({ callbackUrl: '/app/team' })).toBe('/app/team');
  });

  it('blocks auth-page callback loops before considering fallback', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';

    expect(signedInAuthRedirect({ callbackUrl: '/sign-in?callbackUrl=/app' })).toBe(
      '/app/timeline',
    );
  });
});
