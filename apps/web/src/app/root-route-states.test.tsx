// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import GlobalError from '@/app/global-error';
import NotFound from '@/app/not-found';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('root route recovery states', () => {
  it('keeps unauthenticated-safe navigation and one route heading for an unknown address', () => {
    const html = renderToStaticMarkup(<NotFound />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Nothing in your workspace was changed.');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('aria-label="Continue navigating"');
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
    expect(html).toContain('role="status"');
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Reference: digest-123');
  });

  it('retries a root failure with Enter and Space while reporting it to Sentry', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = Object.assign(new Error('route failed'), { digest: 'digest-123' });
    // Next mounts this boundary as the document root; Testing Library mounts in a div.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<GlobalError error={error} reset={reset} />);

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
