import { SELF_SERVE_PLAN_ORDER } from '@timeline/shared/billing/catalog';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  readPendingInvite: vi.fn(),
  readLastLoginMethod: vi.fn(),
  isLegalPublicationReady: vi.fn(() => true),
  hasGoogleAuth: false,
  hasGitHubAuth: false,
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    handlers: vi.fn(() => {
      throw new Error('Unexpected handlers call in this test');
    }),
    signIn: vi.fn(() => {
      throw new Error('Unexpected signIn call in this test');
    }),
    updateSession: vi.fn(() => {
      throw new Error('Unexpected updateSession call in this test');
    }),
    auth: fakes.auth,
    hasGoogleAuth: fakes.hasGoogleAuth,
    hasGitHubAuth: fakes.hasGitHubAuth,
  }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/pending-invite'),
  () => ({ readPendingInvite: fakes.readPendingInvite }),
  () => import('@/lib/pending-invite'),
);
await vi.mock(
  import.meta.resolve('@/lib/last-login-method'),
  () => ({ readLastLoginMethod: fakes.readLastLoginMethod }),
  () => import('@/lib/last-login-method'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal-publication'),
  () => ({ isLegalPublicationReady: fakes.isLegalPublicationReady }),
  () => import('@/lib/legal-publication'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({ ...(await import('next/navigation')), redirect: fakes.redirect }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/components/theme-toggle'),
  () => ({
    ThemeToggle: () => <button type="button">Theme</button>,
  }),
  () => import('@/components/theme-toggle'),
);
await vi.mock(
  import.meta.resolve('@/components/auth-form'),
  () => ({
    SignUpForm: () => <div data-signup-form="true">Sign up form</div>,
  }),
  () => import('@/components/auth-form'),
);
await vi.mock(
  import.meta.resolve('@/components/oauth-buttons'),
  () => ({
    OAuthSignInButtons: () => null,
  }),
  () => import('@/components/oauth-buttons'),
);

const { default: SignUpPage } = await import('@/app/sign-up/page');
const { signupPlanCopy } = await import('@/lib/signup-plan');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue(null);
  fakes.readPendingInvite.mockResolvedValue(null);
  fakes.readLastLoginMethod.mockResolvedValue(null);
  fakes.isLegalPublicationReady.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  fakes.isLegalPublicationReady.mockReturnValue(true);
});

describe('Sign up page', () => {
  it('redirects authenticated visitors into the app', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1', email: 'ada@example.test' } });

    await expect(SignUpPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/app',
    );
  });

  it('redirects authenticated invitees to accept the invite', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1', email: 'ada@example.test' } });

    await expect(
      SignUpPage({
        searchParams: Promise.resolve({ invite: 'invite-token' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/accept-invite/invite-token');
  });
});

describe('SignUpPage plan param', () => {
  it.each([...SELF_SERVE_PLAN_ORDER])('renders catalog copy for plan=%s', async (planId) => {
    const copy = signupPlanCopy(planId);
    const html = renderToStaticMarkup(
      await SignUpPage({
        searchParams: Promise.resolve({ plan: planId }),
      }),
    );

    expect(html).toContain(`data-signup-plan="${planId}"`);
    expect(html).toContain(copy.name);
    expect(html).toContain(copy.subtitle);
    expect(html).toContain(copy.billingStarts);
  });

  it('falls back to Free for unknown plan values and still shows Free details', async () => {
    const copy = signupPlanCopy('free');
    const html = renderToStaticMarkup(
      await SignUpPage({
        searchParams: Promise.resolve({ plan: 'enterprise' }),
      }),
    );

    expect(html).toContain('data-signup-plan="free"');
    expect(html).toContain(copy.subtitle);
  });

  it('skips plan summary for invite sign-up', async () => {
    const html = renderToStaticMarkup(
      await SignUpPage({
        searchParams: Promise.resolve({ invite: 'token', plan: 'team' }),
      }),
    );

    expect(html).toContain('You’ve been invited to a team');
    expect(html).not.toContain('data-signup-plan=');
  });

  it('recovers Team from a preserved Billing callback when plan is omitted', async () => {
    const copy = signupPlanCopy('team');
    const html = renderToStaticMarkup(
      await SignUpPage({
        searchParams: Promise.resolve({
          callbackUrl: '/app/team?section=billing&plan=team#change-plan',
        }),
      }),
    );

    expect(html).toContain('data-signup-plan="team"');
    expect(html).toContain(copy.subtitle);
    expect(html).toContain(copy.billingStarts);
  });
});
