// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/app/actions/objects', () => ({
  markAllNotificationsReadAction: fakes.markAllRead,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));

const { MarkAllReadButton } = await import('./mark-all-read-button.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('MarkAllReadButton', () => {
  it('explains a failed optimistic update and allows a retry', async () => {
    const user = userEvent.setup();
    fakes.markAllRead.mockResolvedValue({ error: 'Database unavailable' });

    render(<MarkAllReadButton hasUnread />);
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to mark notifications as read. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Mark all read' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('refreshes the inbox after marking every notification read', async () => {
    const user = userEvent.setup();
    fakes.markAllRead.mockResolvedValue({ ok: true });

    render(<MarkAllReadButton hasUnread />);
    const button = screen.getByRole('button', { name: 'Mark all read' });
    await user.click(button);

    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(button.getAttribute('aria-busy')).toBe('false');
    });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.querySelector('svg')).toBeNull();
  });
});
