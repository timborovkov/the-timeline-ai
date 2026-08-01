// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: '/help/documents',
  reportCaughtError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => fakes.pathname }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import HelpTopicError from '@/app/help/[slug]/error';
import HelpTopicLoading from '@/app/help/[slug]/loading';
import ContactError from '@/app/help/contact/error';
import ContactLoading from '@/app/help/contact/loading';
import HelpError from '@/app/help/error';
import HelpLoading from '@/app/help/loading';
import SupportError from '@/app/help/support/error';
import SupportLoading from '@/app/help/support/loading';
import { HelpShell } from '@/components/help/help-shell';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Help route states', () => {
  it('keeps Help context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<HelpError error={new Error('route failed')} reset={reset} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
    expect(screen.getByText('Guides for using Timeline and getting support.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load help' })).toBeTruthy();
    expect(
      screen.getByText(
        'The guide and support links are unchanged. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy, help-shaped placeholder', () => {
    render(<HelpLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading help');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading help').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Help loading placeholder' })).toBeTruthy();
  });

  it('identifies the guide navigation and exposes the current page', () => {
    render(
      <HelpShell isSignedIn={false}>
        <article>Guide content</article>
      </HelpShell>,
    );

    expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Document drive' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false);
  });
});

const helpChildRoutes = [
  {
    errorDescription:
      'This error did not change the guide content. Check your connection, then try again.',
    errorPageDescription: 'This Timeline guide could not be loaded.',
    ErrorComponent: HelpTopicError,
    Loading: HelpTopicLoading,
    loadingDescription: 'Loading this Timeline guide.',
    pathname: '/help/documents',
    title: 'Guide',
  },
  {
    errorDescription:
      'This error did not send or change any support request. Check your connection, then try again.',
    errorPageDescription: 'The support request form could not be opened.',
    ErrorComponent: ContactError,
    Loading: ContactLoading,
    loadingDescription: 'Opening the support request form.',
    pathname: '/help/contact',
    title: 'Contact support',
  },
  {
    errorDescription:
      'This error did not send or change any support request. Check your connection, then try again.',
    errorPageDescription: 'The support request form could not be loaded.',
    ErrorComponent: SupportError,
    Loading: SupportLoading,
    loadingDescription: 'Loading the support request form.',
    pathname: '/help/support',
    title: 'Support',
  },
] as const;

describe('Help child route states', () => {
  it.each(helpChildRoutes)(
    'announces a $title loading state outside its busy, Help-shaped placeholder',
    ({ Loading, loadingDescription, pathname, title }) => {
      fakes.pathname = pathname;
      render(
        <HelpShell isSignedIn={false}>
          <Loading />
        </HelpShell>,
      );

      const announcement = screen.getByRole('status');
      expect(announcement.textContent).toBe(`Loading ${title}`);
      expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
      expect(screen.getByLabelText(`${title} loading placeholder`).getAttribute('aria-busy')).toBe(
        'true',
      );
      expect(screen.getAllByRole('heading', { level: 1, name: title })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title }).className).toContain(
        'text-2xl',
      );
      expect(screen.getByRole('heading', { level: 1, name: title }).className).not.toContain(
        'sm:text-4xl',
      );
      expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
      expect(screen.getByText(loadingDescription)).toBeTruthy();
      expect(
        within(screen.getByRole('navigation', { name: 'Help guides' }))
          .getByRole('link', {
            name: 'Support',
          })
          .getAttribute('aria-current'),
      ).toBe(pathname === '/help/contact' || pathname === '/help/support' ? 'page' : null);
    },
  );

  it.each(helpChildRoutes)(
    'keeps Help context and lets keyboard users retry the $title error',
    async ({ errorDescription, errorPageDescription, ErrorComponent, pathname, title }) => {
      const user = userEvent.setup();
      const reset = vi.fn();
      fakes.pathname = pathname;

      render(
        <HelpShell isSignedIn={false}>
          <ErrorComponent error={new Error('route failed')} reset={reset} />
        </HelpShell>,
      );

      expect(screen.getAllByRole('heading', { level: 1, name: title })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: title }).className).toContain(
        'text-2xl',
      );
      expect(screen.getByRole('heading', { level: 1, name: title }).className).not.toContain(
        'sm:text-4xl',
      );
      expect(screen.getByRole('navigation', { name: 'Help guides' })).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: `Unable to load ${title}` }),
      ).toBeTruthy();
      expect(screen.getByText(errorDescription)).toBeTruthy();
      expect(screen.getByText(errorPageDescription)).toBeTruthy();
      expect(
        within(screen.getByRole('navigation', { name: 'Help guides' }))
          .getByRole('link', {
            name: 'Support',
          })
          .getAttribute('aria-current'),
      ).toBe(pathname === '/help/contact' || pathname === '/help/support' ? 'page' : null);

      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');

      expect(reset).toHaveBeenCalledTimes(2);
    },
  );
});
