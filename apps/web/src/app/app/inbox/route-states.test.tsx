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

    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(reset).toHaveBeenCalledOnce();
  });

  it('announces loading outside an inert, motion-safe inbox skeleton and retains one route heading', () => {
    const { container } = render(<InboxLoading />);

    const announcement = screen.getByRole('status');
    expect(announcement.textContent).toBe('Loading inbox');
    expect(announcement.closest('[aria-busy="true"]')).toBeNull();
    const loading = screen.getByLabelText('Loading inbox');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.className).toContain('motion-reduce:[&_.animate-pulse]:animate-none');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Inbox' })).toHaveLength(1);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();

    const placeholder = container.querySelector('[aria-busy="true"] > [aria-hidden="true"][inert]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
  });
});
