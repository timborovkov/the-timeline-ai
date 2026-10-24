// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import SignInError from '@/app/sign-in/error';
import SignInLoading from '@/app/sign-in/loading';
import SignUpError from '@/app/sign-up/error';
import SignUpLoading from '@/app/sign-up/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const authRoutes = [
  {
    ErrorComponent: SignInError,
    Loading: SignInLoading,
    alternate: { href: '/sign-up', label: 'Create one' },
    description:
      'Your account and existing session were not changed. Check your connection, then try again.',
    errorTitle: 'Unable to load sign in',
    loadingLabel: 'Sign-in loading placeholder',
    loadingText: 'Loading sign in',
    subtitle: 'Sign in to your team’s timeline.',
    title: 'Welcome back',
  },
  {
    ErrorComponent: SignUpError,
    Loading: SignUpLoading,
    alternate: undefined,
    description:
      'No account was created by this failed load. Check your connection, then try again.',
    errorTitle: 'Unable to load account creation',
    loadingLabel: 'Account creation loading placeholder',
    loadingText: 'Loading account creation',
    subtitle: 'We’ll create your first team automatically.',
    title: 'Create your account',
  },
] as const;

describe('Auth route states', () => {
  it('does not offer an invite-dropping alternate path while sign-up is recovering', () => {
    const { unmount } = render(<SignUpLoading />);

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();

    unmount();
    render(<SignUpError error={new Error('route failed')} reset={vi.fn()} />);

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it.each(authRoutes)(
    'announces the $title loading state outside its busy form placeholder',
    ({ Loading, loadingLabel, loadingText, subtitle, title }) => {
      render(<Loading />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.getByText(subtitle)).toBeTruthy();

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(loadingText);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();

      const placeholder = screen.getByRole('region', { name: loadingLabel });
      expect(placeholder.getAttribute('aria-busy')).toBe('true');
      expect(placeholder.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      for (const skeleton of document.querySelectorAll('.animate-pulse')) {
        expect(skeleton.className).toContain('motion-reduce:animate-none');
      }
    },
  );

  it.each(authRoutes)(
    'preserves $title recovery context and retries with Enter and Space',
    async ({ ErrorComponent, alternate, description, errorTitle, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();

      render(<ErrorComponent error={new Error('route failed')} reset={reset} />);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: errorTitle })).toBeTruthy();
      expect(screen.getByText(description)).toBeTruthy();
      if (alternate) {
        expect(screen.getByRole('link', { name: alternate.label }).getAttribute('href')).toBe(
          alternate.href,
        );
      } else {
        expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
      }

      const retry = screen.getByRole('button', { name: 'Retry' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');

      expect(reset).toHaveBeenCalledTimes(2);
    },
  );
});
