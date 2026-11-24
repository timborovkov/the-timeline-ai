import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  inviteTokenFromCallback,
  postSignupDestination,
  signedInAuthRedirect,
  selectedPlanCallback,
  selectedPlanFromCallback,
  signUpHrefFromAuthCallback,
  signupCallback,
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

  it('continues a guest invitation without converting it into a full-member invite', () => {
    const callbackUrl = `/guest/11111111-1111-4111-8111-111111111111/invite/${'a'.repeat(43)}`;
    expect(signedInAuthRedirect({ callbackUrl, pendingInviteToken: 'other-invite' })).toBe(
      callbackUrl,
    );
    expect(signUpHrefFromAuthCallback(callbackUrl)).toBe(
      `/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
    expect(postSignupDestination({ event: 'account_created', callbackUrl })).toBe(callbackUrl);
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

describe('invite callback helpers', () => {
  it('extracts invite tokens from accept-invite callbacks', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    expect(inviteTokenFromCallback('/accept-invite/callback-token')).toBe('callback-token');
    expect(inviteTokenFromCallback('/accept-invite/invite%201')).toBe('invite 1');
    expect(inviteTokenFromCallback('/app')).toBeUndefined();
  });

  it('links sign-up with invite query when the callback is accept-invite', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    expect(signUpHrefFromAuthCallback('/accept-invite/callback-token')).toBe(
      '/sign-up?invite=callback-token',
    );
    expect(signUpHrefFromAuthCallback('/app/team')).toBe('/sign-up?callbackUrl=%2Fapp%2Fteam');
    expect(signUpHrefFromAuthCallback(undefined)).toBe('/sign-up');
  });
});

describe('pricing plan intent', () => {
  it('allows only self-serve paid plans without authorizing a purchase', () => {
    expect(selectedPlanCallback('payg')).toBe('/app/team?section=billing&plan=payg#change-plan');
    expect(selectedPlanCallback('team')).toBe('/app/team?section=billing&plan=team#change-plan');
    expect(selectedPlanCallback('business')).toBe(
      '/app/team?section=billing&plan=business#change-plan',
    );
    expect(selectedPlanCallback('free')).toBeUndefined();
    expect(selectedPlanCallback('https://evil.test')).toBeUndefined();
    expect(selectedPlanCallback('enterprise')).toBeUndefined();
    expect(selectedPlanCallback(['payg'])).toBeUndefined();
  });

  it('keeps paid Billing callbacks for existing accounts while rejecting auth loops', () => {
    expect(signupCallback(undefined, 'team')).toBe(
      '/app/team?section=billing&plan=team#change-plan',
    );
    expect(signupCallback('/app/team?section=billing&plan=team#change-plan', 'team')).toBe(
      '/app/team?section=billing&plan=team#change-plan',
    );
    expect(signupCallback(undefined, 'free')).toBeUndefined();
    expect(signupCallback('/oauth/authorize?state=a', 'business')).toBe('/oauth/authorize?state=a');
  });

  it('sends solo signups to Welcome onboarding ahead of plan intent destinations', () => {
    expect(
      postSignupDestination({
        event: 'account_created',
        callbackUrl: '/app',
      }),
    ).toBe('/onboarding');
    expect(
      postSignupDestination({
        event: 'account_created',
        callbackUrl: '/app/team?section=billing&plan=team#change-plan',
      }),
    ).toBe('/onboarding');
    expect(
      postSignupDestination({
        event: 'account_created',
        callbackUrl: '/oauth/authorize?client_id=test&state=a',
      }),
    ).toBe('/onboarding');
    expect(
      postSignupDestination({
        inviteToken: 'token',
        event: 'invite_accepted',
        callbackUrl: '/accept-invite/token',
      }),
    ).toBe('/app');
    expect(
      postSignupDestination({
        event: 'invite_accepted',
        callbackUrl: '/oauth/authorize?state=a',
      }),
    ).toBe('/app');
  });
});

it('carries only fixed plan destinations into verification emails', () => {
  expect(selectedPlanFromCallback(selectedPlanCallback('payg'))).toBe('payg');
  expect(selectedPlanFromCallback(selectedPlanCallback('team'))).toBe('team');
  expect(selectedPlanFromCallback('/app/team?plan=payg&section=billing')).toBe('payg');
  expect(selectedPlanFromCallback('https://evil.test/app/team?plan=payg')).toBeUndefined();
  expect(
    selectedPlanFromCallback('/app/team?section=billing&plan=enterprise#change-plan'),
  ).toBeUndefined();
  expect(selectedPlanFromCallback('/accept-invite/token')).toBeUndefined();
});
