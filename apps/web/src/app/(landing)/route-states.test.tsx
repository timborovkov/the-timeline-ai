// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import LandingError from '@/app/(landing)/error';
import LandingLoading from '@/app/(landing)/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Landing route states', () => {
  it('announces a responsive landing-shaped loading state outside busy content', () => {
    const html = renderToStaticMarkup(<LandingLoading />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('The work <em>becomes</em> the record.');
    expect(html).toContain('Gathering evidence');
    expect(html).toContain('Slack');
    expect(html).toContain('Meeting');
    expect(html).toContain('GitHub');
    expect(html).toContain('Drive');
    expect(html).toContain('aria-live="polite"');
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-busy="true"'));
    expect(html).toContain('aria-label="The Timeline loading placeholder"');
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/help/support"');

    render(<LandingLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading The Timeline');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(
      screen.getByLabelText('The Timeline loading placeholder').getAttribute('aria-busy'),
    ).toBe('true');
  });

  it('keeps auth-neutral landing context and lets keyboard users retry safely after a failed load', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();

    render(<LandingError error={new Error('offline')} reset={reset} />);

    expect(
      screen.getAllByRole('heading', { level: 1, name: 'The record did not resolve.' }),
    ).toHaveLength(1);
    expect(screen.getByText('Evidence interrupted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'The Timeline home' }).getAttribute('href')).toBe('/');
    const navigation = screen.getByRole('navigation', { name: 'Landing navigation' });
    expect(within(navigation).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe(
      '/help',
    );
    expect(within(navigation).getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(
      '/help/support',
    );
    expect(within(navigation).queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(within(navigation).queryByRole('link', { name: 'Create team' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load The Timeline' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed load did not change any account or workspace data. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('moves keyboard focus to the landing recovery content when its skip link is activated', async () => {
    const user = userEvent.setup();

    render(<LandingLoading />);

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    const main = screen.getByRole('main');
    skipLink.focus();

    await user.keyboard('{Enter}');

    expect(main.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(main);
    expect(skipLink.className).toContain('focus:z-[90]');
  });

  it('ships responsive recovery navigation constraints and layers the skip link above the sticky header', () => {
    const html = renderToStaticMarkup(<LandingLoading />);

    expect(html).toContain('focus:z-[90]');
    expect(html).toContain('Every answer cited');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html).toContain('aria-label="Landing navigation"');
    expect(html).toContain('href="/help/support"');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/sign-up"');
  });
});
