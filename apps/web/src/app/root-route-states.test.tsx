// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn(), auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import { RootNotFoundContent } from '@/app/_root-not-found-content';
import AppNotFound from '@/app/app/not-found';
import GlobalError from '@/app/global-error';
import HelpNotFound from '@/app/help/not-found';
import NotFound from '@/app/not-found';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('root route recovery states', () => {
  it('keeps unauthenticated-safe navigation and one route heading for an unknown address', async () => {
    fakes.auth.mockResolvedValue(null);
    const html = renderToStaticMarkup(await NotFound());

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Nothing in your workspace was changed.');
    expect(html).toContain('href="#main"');
    expect(html).toContain('focus:z-[60]');
    expect(html).toContain('<main id="main" tabindex="-1"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('aria-label="Continue navigating"');
  });

  it('keeps signed-in people oriented toward the workspace from an unknown address', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
    const html = renderToStaticMarkup(await NotFound());

    expect(html).toContain('>Open app<');
    expect(html).not.toContain('>Sign in<');
  });

  it('keeps unmatched workspace and help content inside their existing shell landmarks', () => {
    const appHtml = renderToStaticMarkup(<AppNotFound />);
    const helpHtml = renderToStaticMarkup(<HelpNotFound />);

    expect(appHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(appHtml).not.toContain('<main');
    expect(appHtml).toContain('Nothing in your workspace was changed.');
    expect(appHtml).toContain('rounded-lg border border-border bg-surface');
    expect(appHtml).toContain('href="/app"');
    expect(appHtml).toContain('href="/app/work"');

    expect(helpHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(helpHtml).not.toContain('<main');
    expect(helpHtml).toContain('Your workspace and support requests are unchanged.');
    expect(helpHtml).toContain('href="/help"');
    expect(helpHtml).toContain('href="/help/support"');
  });

  it('moves focus to the unknown-address heading without changing its native link navigation', async () => {
    const user = userEvent.setup();

    render(<RootNotFoundContent />);

    const title = screen.getByRole('heading', { name: 'Page not found' });
    expect(
      title.closest('main')?.querySelector('.rounded-lg.border-border.bg-surface'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(title);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Return home' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open workspace' }));
  });
    it('reports a root failure and preserves safe retry guidance with technical details closed', () => {
    const html = renderToStaticMarkup(
      <GlobalError
        error={Object.assign(new Error('route failed'), { digest: 'digest-123' })}
        reset={vi.fn()}
      />,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Your saved workspace data has not been changed.');
    expect(html).toContain('<main');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Reference: digest-123');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('color: #20211e;');
    expect(html).toContain('.global-error-button:focus-visible');
  });

  it('focuses, retries, and reports a root failure', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = Object.assign(new Error('route failed'), { digest: 'digest-123' });
    // Next mounts this boundary as the document root; Testing Library mounts in a div.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<GlobalError error={error} reset={reset} />);

      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'We couldn’t open this page' }),
      );
      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();
      await user.keyboard('{Enter}');
      await user.keyboard('[Space]');

      expect(reset).toHaveBeenCalledTimes(2);
      expect(fakes.reportCaughtError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ operation: 'global_error_boundary' }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
