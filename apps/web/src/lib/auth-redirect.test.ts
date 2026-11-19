import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  postSignupDestination,
  signedInAuthRedirect,
  selectedPlanCallback,
  selectedPlanFromCallback,
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
    expect(selectedPlanCallback('team')).toBe('/app/team?section=billing&plan=team#change-plan');
    expect(selectedPlanCallback('business')).toBe(
      '/app/team?section=billing&plan=business#change-plan',
    );
    expect(selectedPlanCallback('free')).toBeUndefined();
    expect(selectedPlanCallback('https://evil.test')).toBeUndefined();
    expect(selectedPlanCallback('enterprise')).toBeUndefined();
    expect(selectedPlanCallback(['payg'])).toBeUndefined();
  });

  it('routes paid signups into onboarding instead of billing checkout', () => {
    expect(signupCallback(undefined, 'team')).toBe('/onboarding');
    expect(signupCallback('/app/team?section=billing&plan=team#change-plan', 'team')).toBe(
      '/app/team?section=billing&plan=team#change-plan',
    );
    expect(signupCallback(undefined, 'free')).toBeUndefined();
    expect(signupCallback('/oauth/authorize?state=a', 'business')).toBe('/oauth/authorize?state=a');
  });

  it('keeps invite and MCP authorize continuations ahead of first-run onboarding', () => {
    expect(
      postSignupDestination({
        event: 'team_created',
        callbackUrl: '/accept-invite/token%201',
      }),
    ).toBe('/accept-invite/token%201');
    expect(
      postSignupDestination({
        event: 'team_created',
        callbackUrl: '/oauth/authorize?client_id=test&state=a',
      }),
    ).toBe('/oauth/authorize?client_id=test&state=a');
    expect(
      postSignupDestination({
        event: 'team_created',
        callbackUrl: '/app',
      }),
    ).toBe('/onboarding');
    expect(
      postSignupDestination({
        event: 'team_created',
        callbackUrl: '/app/team?section=billing&plan=team#change-plan',
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
    ).toBe('/oauth/authorize?state=a');
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
