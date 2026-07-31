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

  it('announces a single-heading invitation loading state', () => {
    render(<AcceptInviteLoading />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Loading invitation');
    expect(screen.getByRole('status').textContent).toBe('Loading invitation');
    expect(screen.getByLabelText('Invitation loading placeholder').getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('provides an announced, keyboard-operable retry for a failed invitation load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<AcceptInviteError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Invite unavailable');
    expect(screen.getByRole('alert').textContent).toBe(
      'Unable to load invitationCheck your connection, then try again.Try again',
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
