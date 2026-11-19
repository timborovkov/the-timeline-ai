import { SELF_SERVE_PLAN_ORDER } from '@timeline/shared/billing/catalog';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(() => Promise.resolve(null)),
  readLastLoginMethod: vi.fn(() => Promise.resolve(null)),
  isLegalPublicationReady: vi.fn(() => true),
  hasGoogleAuth: false,
  hasGitHubAuth: false,
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({
    auth: fakes.auth,
    hasGoogleAuth: fakes.hasGoogleAuth,
    hasGitHubAuth: fakes.hasGitHubAuth,
  }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/last-login-method'),
  () => ({
    readLastLoginMethod: fakes.readLastLoginMethod,
  }),
  () => import('@/lib/last-login-method'),
);
await vi.mock(
  import.meta.resolve('@/lib/legal-publication'),
  () => ({
    isLegalPublicationReady: fakes.isLegalPublicationReady,
  }),
  () => import('@/lib/legal-publication'),
);
await vi.mock(
  import.meta.resolve('@/lib/pending-invite'),
  () => ({
    readPendingInvite: () => Promise.resolve(null),
  }),
  () => import('@/lib/pending-invite'),
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

afterEach(() => {
  vi.clearAllMocks();
  fakes.isLegalPublicationReady.mockReturnValue(true);
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
