// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  pathname: '/help/documents',
  reportCaughtError: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => fakes.pathname }));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import HelpError from '@/app/help/error';
import HelpLoading from '@/app/help/loading';
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
