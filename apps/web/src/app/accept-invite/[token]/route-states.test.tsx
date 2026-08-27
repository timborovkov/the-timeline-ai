// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: vi.fn() }));
vi.mock('@/app/actions/invites', () => ({ acceptInviteAction: vi.fn() }));
vi.mock('@timeline/db', () => ({ getDb: () => ({}), teamInvites: {}, teams: {} }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

const { default: AcceptInviteError } = await import('./error.js');
const { default: AcceptInviteLoading } = await import('./loading.js');
const { default: AcceptInvitePage } = await import('./page.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AcceptInvite route states', () => {
  it('keeps a single page heading before an invited person signs in', async () => {
    fakes.auth.mockResolvedValue(null);

    const html = renderToStaticMarkup(
      await AcceptInvitePage({
        params: Promise.resolve({ token: 'invite-token' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Accept invite');
  });

  it('announces a single-heading invitation loading state outside its busy placeholder', () => {
    render(<AcceptInviteLoading />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Loading invitation');
    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading invitation');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Invitation loading placeholder').getAttribute('aria-busy')).toBe(
      'true',
    );
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons).toHaveLength(4);
    expect(
      [...skeletons].every((skeleton) => skeleton.classList.contains('motion-reduce:animate-none')),
    ).toBe(true);
  });

  it('provides an announced, keyboard-operable retry for a failed invitation load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<AcceptInviteError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Accept invitation');
    expect(screen.getByText('Review the invitation before joining the team.')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Unable to load invitation' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to load invitationThis failed load did not accept your invitation or change your team access. Check your connection, then try again.RetryGet support',
    );

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
