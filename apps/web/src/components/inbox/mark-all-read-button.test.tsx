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
  it('rolls back safely and retries a failed optimistic update with the keyboard', async () => {
    const user = userEvent.setup();
    fakes.markAllRead
      .mockResolvedValueOnce({ error: 'Database unavailable' })
      .mockResolvedValueOnce({ ok: true });

    render(<MarkAllReadButton hasUnread />);
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Unable to mark notifications as read. Your notifications remain unread.',
    );
    expect(screen.getByRole('button', { name: 'Mark all read' }).hasAttribute('disabled')).toBe(
      false,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.tab();
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(fakes.markAllRead).toHaveBeenCalledTimes(2);
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('announces when marking notifications as read is in progress', async () => {
    let resolveAction: (value: { ok: true }) => void = () => {
      throw new Error('Expected the mark-all action to be pending');
    };
    fakes.markAllRead.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<MarkAllReadButton hasUnread />);
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(screen.getByText('Marking all notifications as read.').getAttribute('aria-live')).toBe(
      'polite',
    );
    resolveAction({ ok: true });
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
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
