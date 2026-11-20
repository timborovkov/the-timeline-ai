import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('@/components/theme-toggle'),
  () => ({
    ThemeToggle: () => <button type="button">Theme</button>,
  }),
  () => import('@/components/theme-toggle'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: vi.fn() }),
  () => import('@/lib/sentry-report'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/lib/email-verification'),
  () => ({ inspectEmailVerificationToken: vi.fn(), verifyEmailToken: vi.fn() }),
  () => import('@/lib/email-verification'),
);

await vi.mock(
  import.meta.resolve('@/lib/auth-continuation'),
  () => ({ resolveAuthContinuation: vi.fn() }),
  () => import('@/lib/auth-continuation'),
);
const { resolveAuthContinuation } = await import('@/lib/auth-continuation');

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToStaticMarkup } = await import('react-dom/server');
const { inspectEmailVerificationToken, verifyEmailToken } =
  await import('@/lib/email-verification');
const { confirmEmailVerification } = await import('./actions.js');
const TOKEN = 'a'.repeat(43);
const CONTINUATION = 'b'.repeat(43);

const { default: VerifyEmailError } = await import('./error.js');
const { default: VerifyEmailLoading } = await import('./loading.js');
const { default: VerifyEmailPage } = await import('./page.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VerifyEmail route states', () => {
  it('keeps a single page heading for an invalid verification link', async () => {
    const html = renderToStaticMarkup(
      await VerifyEmailPage({
        params: Promise.resolve({ token: 'verification-token' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Verification link invalid');
  });

  it('renders the confirmation form without consuming tokens or continuations', async () => {
    vi.mocked(inspectEmailVerificationToken).mockResolvedValueOnce('confirm');
    const html = renderToStaticMarkup(
      await VerifyEmailPage({
        params: Promise.resolve({ token: TOKEN }),
        searchParams: Promise.resolve({ email: 'person@example.com', continuation: CONTINUATION }),
      }),
    );
    expect(html).toContain('Confirm email');
    expect(verifyEmailToken).not.toHaveBeenCalled();
    expect(resolveAuthContinuation).not.toHaveBeenCalled();
  });

  it('resolves a continuation only after successful confirmation', async () => {
    for (const destination of ['/oauth/authorize?state=saved', null]) {
      vi.mocked(verifyEmailToken).mockResolvedValueOnce('verified');
      vi.mocked(resolveAuthContinuation).mockResolvedValueOnce(destination);
      const result = await confirmEmailVerification(
        { email: 'person@example.com', token: TOKEN, continuation: CONTINUATION },
        null,
      );
      expect(result).toMatchObject({
        status: 'verified',
        continuationExpired: !destination,
        next: destination ? 'agent' : 'dashboard',
      });
      expect(resolveAuthContinuation).toHaveBeenCalledWith({}, CONTINUATION, 'person@example.com');
    }
  });

  it('lets verification-service failures reach the route error boundary', async () => {
    vi.mocked(inspectEmailVerificationToken).mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(
      VerifyEmailPage({
        params: Promise.resolve({ token: TOKEN }),
        searchParams: Promise.resolve({ email: 'person@example.com' }),
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('announces a single-heading email verification loading state outside its busy placeholder', () => {
    render(<VerifyEmailLoading />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Checking verification link',
    );
    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Checking verification link');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(
      screen.getByLabelText('Email verification loading placeholder').getAttribute('aria-busy'),
    ).toBe('true');
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons).toHaveLength(3);
    expect(
      [...skeletons].every((skeleton) => skeleton.classList.contains('motion-reduce:animate-none')),
    ).toBe(true);
    expect([...skeletons].every((skeleton) => skeleton.closest('[aria-hidden="true"]'))).toBe(true);
  });

  it('provides an announced, keyboard-operable retry for an email verification failure', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<VerifyEmailError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Email verification');
    expect(screen.getByText('Confirm the email address for your Timeline account.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to verify email' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to verify emailEmail verification could not be confirmed. If you submitted the confirmation, your address may already be verified. Check your connection, then try again.RetryGet support',
    );
    expect(screen.getByRole('link', { name: 'Open dashboard' }).getAttribute('href')).toBe('/app');

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });
});

it('preserves an allowlisted plan through a verified email and fresh sign-in', async () => {
  vi.mocked(verifyEmailToken).mockResolvedValueOnce('verified');
  await expect(
    confirmEmailVerification({ token: TOKEN, email: 'user@example.test', plan: 'payg' }, null),
  ).resolves.toMatchObject({
    next: 'billing',
    href: '/sign-in?callbackUrl=%2Fapp%2Fteam%3Fsection%3Dbilling%26plan%3Dpayg%23change-plan',
  });
  vi.mocked(verifyEmailToken).mockResolvedValueOnce('verified');
  await expect(
    confirmEmailVerification(
      { token: TOKEN, email: 'user@example.test', plan: '//evil.test' },
      null,
    ),
  ).resolves.toMatchObject({ next: 'dashboard', href: '/app' });
});
