import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  signedInAuthRedirect,
  selectedPlanCallback,
  selectedPlanFromCallback,
} from '@/lib/auth-redirect';
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

    expect(signedInAuthRedirect({ callbackUrl: '/sign-in?callbackUrl=/app' })).toBe('/app');
  });
});

describe('pricing plan intent', () => {
  it('allows only self-serve paid plans without authorizing a purchase', () => {
    expect(selectedPlanCallback('payg')).toBe('/app/team?section=billing&plan=payg#change-plan');
    expect(selectedPlanCallback('https://evil.test')).toBeUndefined();
    expect(selectedPlanCallback('enterprise')).toBeUndefined();
    expect(selectedPlanCallback(['payg'])).toBeUndefined();
  });
});

it('carries only fixed plan destinations into verification emails', () => {
  expect(selectedPlanFromCallback(selectedPlanCallback('payg'))).toBe('payg');
  expect(selectedPlanFromCallback('/app/team?plan=payg&section=billing')).toBe('payg');
  expect(selectedPlanFromCallback('https://evil.test/app/team?plan=payg')).toBeUndefined();
  expect(
    selectedPlanFromCallback('/app/team?section=billing&plan=enterprise#change-plan'),
  ).toBeUndefined();
  expect(selectedPlanFromCallback('/accept-invite/token')).toBeUndefined();
});
