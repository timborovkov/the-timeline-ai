// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/app/actions/objects', () => ({
  markAllNotificationsReadAction: fakes.markAllRead,
  markNotificationReadAction: fakes.markRead,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fakes.refresh, push: fakes.push }),
}));
vi.mock('@/components/workspace-timezone-context', () => ({ useWorkspaceTimezone: () => 'UTC' }));

const { InboxBell } = await import('./inbox-bell.js');

const notification = {
  id: 'notification-1',
  kind: 'agent_suggestion',
  summary: 'Review the launch plan',
  entityId: null,
  agentSuggestionId: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  readAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('InboxBell', () => {
  it('uses the same human notification label as the Inbox', async () => {
    const user = userEvent.setup();

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));

    expect(screen.getByText('Suggestion ready')).toBeTruthy();
    expect(screen.queryByText('agent suggestion')).toBeNull();
  });

  it('keeps unread notifications visible and reports a failed bulk read without refreshing', async () => {
    const user = userEvent.setup();
    fakes.markAllRead.mockResolvedValue({ error: 'Database unavailable' });

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to update notifications. They remain unread. Try again.',
    );
    expect(screen.getByText('Review the launch plan')).toBeTruthy();
    expect(fakes.refresh).not.toHaveBeenCalled();
  });

  it('keeps the read action disabled and announces its pending state', async () => {
    let resolveAction: (value: { ok: true }) => void = () => {
      throw new Error('Expected the read action to be pending');
    };
    fakes.markAllRead.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    const button = screen.getByRole('button', { name: 'Marking all read…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);

    resolveAction({ ok: true });
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the menu open when an individual read fails, then navigates only after a successful retry', async () => {
    const user = userEvent.setup();
    fakes.markRead
      .mockResolvedValueOnce({ error: 'Database unavailable' })
      .mockResolvedValueOnce({ ok: true });

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));
    const item = screen.getByRole('link', { name: /Review the launch plan/i });
    await user.click(item);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to update notifications. They remain unread. Try again.',
    );
    expect(fakes.refresh).not.toHaveBeenCalled();
    expect(fakes.push).not.toHaveBeenCalled();

    await user.click(item);
    await waitFor(() => {
      expect(fakes.markRead).toHaveBeenCalledTimes(2);
      expect(fakes.push).toHaveBeenCalledWith('/app/inbox');
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('prevents overlapping individual read actions while one is pending', async () => {
    let resolveAction: (value: { ok: true }) => void = () => {
      throw new Error('Expected the individual read action to be pending');
    };
    fakes.markRead.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));
    const item = screen.getByRole('link', { name: /Review the launch plan/i });
    await user.click(item);

    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Marking notification as read').getAttribute('aria-live')).toBe(
      'polite',
    );
    await user.click(item);
    expect(fakes.markRead).toHaveBeenCalledTimes(1);

    resolveAction({ ok: true });
    await waitFor(() => {
      expect(fakes.push).toHaveBeenCalledWith('/app/inbox');
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Marking notification as read')).toBeNull();
  });
});
