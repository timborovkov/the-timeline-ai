import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportCaughtError: fakes.reportCaughtError }),
  () => import('@/lib/sentry-report'),
);

const { cleanup, render, screen, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: LandingError } = await import('@/app/(landing)/error');
const { default: LandingLoading } = await import('@/app/(landing)/loading');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Landing route states', () => {
  it('announces a responsive landing-shaped loading state outside busy content', () => {
    const html = renderToStaticMarkup(<LandingLoading />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Scattered work. <em>Cited answers.</em>');
    expect(html).toContain('AI team memory');
    expect(html).toContain('trace each claim back to the source');
    expect(html).toContain('aria-live="polite"');
    expect(html.indexOf('aria-live="polite"')).toBeLessThan(html.indexOf('aria-busy="true"'));
    expect(html).toContain('aria-label="The Timeline loading placeholder"');
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/help/support"');
    expect(html).toContain('href="/cookies"');

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
    const navigation = screen.getByRole('navigation', { name: 'Public navigation' });
    expect(within(navigation).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe(
      '/help',
    );
    expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(
      '/help/support',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Try one project' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start free' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load The Timeline' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'This failed load did not change any account or workspace data. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Retry' });
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
    expect(html).toContain('>Product</a>');
    expect(html).toContain('>Integrations</a>');
    expect(html).toContain('>How it works</a>');
    expect(html).toContain('>Help</a>');
    expect(html).toContain('aria-label="The Timeline source code on GitHub"');
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('aria-label="Public navigation menu"');
    expect(html).toContain('href="/help/support"');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/sign-up"');
    expect(html).not.toContain('>Start free</a>');
    expect(html).not.toContain('>Dashboard</a>');
  });

  it('keeps the landing loading masthead auth-neutral instead of guessing session state', () => {
    render(<LandingLoading />);

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start free' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Public navigation' })).toBeTruthy();
    expect(screen.getByLabelText('The Timeline source code on GitHub')).toBeTruthy();
  });
});
