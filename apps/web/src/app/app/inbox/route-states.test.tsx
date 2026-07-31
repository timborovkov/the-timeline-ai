// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));

vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

import InboxError from '@/app/app/inbox/error';
import InboxLoading from '@/app/app/inbox/loading';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Inbox route states', () => {
  it('retains inbox context and lets keyboard users retry a failed load', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<InboxError error={new Error('route failed')} reset={reset} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Inbox' })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Unable to load inbox' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your notifications and read status have not changed. Check your connection, then try again.',
      ),
    ).toBeTruthy();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside the busy inbox placeholder and retains one route heading', () => {
    render(<InboxLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading inbox');
    expect(announcement.parentElement?.getAttribute('aria-busy')).toBeNull();
    expect(screen.getByLabelText('Loading inbox').getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Inbox' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Inbox loading placeholder' })).toBeTruthy();
  });
});
