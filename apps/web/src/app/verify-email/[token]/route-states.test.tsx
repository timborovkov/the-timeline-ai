// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyEmailToken } from '@/lib/email-verification';

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/email-verification', () => ({ verifyEmailToken: vi.fn() }));

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

  it('lets verification-service failures reach the route error boundary', async () => {
    vi.mocked(verifyEmailToken).mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      VerifyEmailPage({
        params: Promise.resolve({ token: 'verification-token' }),
        searchParams: Promise.resolve({ email: 'person@example.com' }),
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('announces a single-heading email verification loading state outside its busy placeholder', () => {
    render(<VerifyEmailLoading />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Verifying email');
    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Verifying email');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(
      screen.getByLabelText('Email verification loading placeholder').getAttribute('aria-busy'),
    ).toBe('true');
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons).toHaveLength(3);
    expect(
      [...skeletons].every((skeleton) => skeleton.classList.contains('motion-reduce:animate-none')),
    ).toBe(true);
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
      'Unable to verify emailEmail verification could not be confirmed. If you just opened this link, it may already have succeeded. Check your connection, then try again.Try again',
    );
    expect(screen.getByRole('link', { name: 'Open dashboard' }).getAttribute('href')).toBe('/app');

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
