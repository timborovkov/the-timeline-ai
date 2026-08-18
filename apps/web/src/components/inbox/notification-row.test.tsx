// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/app/actions/objects', () => ({
  markAllNotificationsReadAction: fakes.markAllRead,
  markNotificationReadAction: fakes.markRead,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
    try {
      return await run();
    } catch {
      return { error: 'failed' };
    }
  },
}));

const { MarkAllReadButton } = await import('./mark-all-read-button.js');
const { NotificationRow } = await import('./notification-row.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('NotificationRow', () => {
  it('uses a human notification label instead of exposing the stored enum', () => {
    render(
      <ul>
        <NotificationRow
          id="notification-1"
          kind="agent_suggestion"
          summary="Review the launch plan"
          entityId={null}
          agentSuggestionId={null}
          createdAt="2026-07-29T12:00:00.000Z"
          initiallyRead={false}
        />
      </ul>,
    );

    expect(screen.getByText('Suggestion ready')).toBeTruthy();
    expect(screen.queryByText('agent suggestion')).toBeNull();
  });

  it('keeps unread status explicit and rolls back a failed read action', async () => {
    const user = userEvent.setup();
    fakes.markRead.mockResolvedValue({ error: 'Database unavailable' });

    render(
      <ul>
        <NotificationRow
          id="notification-1"
          kind="agent_suggestion"
          summary="Review the launch plan"
          entityId={null}
          agentSuggestionId={null}
          createdAt="2026-07-29T12:00:00.000Z"
          initiallyRead={false}
        />
      </ul>,
    );

    expect(screen.getByText('Unread')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark Review the launch plan as read' }));

    expect(await screen.findByText('Unread')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fakes.refresh).not.toHaveBeenCalled();
  });

  it('applies a successful Mark all read after an individual read rolls back', async () => {
    const user = userEvent.setup();
    fakes.markRead.mockResolvedValue({ error: 'Database unavailable' });
    fakes.markAllRead.mockResolvedValue({ ok: true });

    render(
      <>
        <MarkAllReadButton hasUnread />
        <ul>
          <NotificationRow
            id="notification-1"
            kind="agent_suggestion"
            summary="Review the launch plan"
            entityId={null}
            agentSuggestionId={null}
            createdAt="2026-07-29T12:00:00.000Z"
            initiallyRead={false}
          />
        </ul>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Mark Review the launch plan as read' }));
    expect(await screen.findByText('Unread')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Unread')).toBeNull();
  });

  it('marks the row read when refreshed props confirm it is read', async () => {
    const user = userEvent.setup();
    fakes.markRead.mockResolvedValue({ error: 'Database unavailable' });
    const props = {
      id: 'notification-1',
      kind: 'agent_suggestion',
      summary: 'Review the launch plan',
      entityId: null,
      agentSuggestionId: null,
      createdAt: '2026-07-29T12:00:00.000Z',
    };

    const view = render(
      <ul>
        <NotificationRow {...props} initiallyRead={false} />
      </ul>,
    );

    await user.click(screen.getByRole('button', { name: 'Mark Review the launch plan as read' }));
    expect(await screen.findByText('Unread')).toBeTruthy();

    view.rerender(
      <ul>
        <NotificationRow {...props} initiallyRead />
      </ul>,
    );

    expect(screen.queryByText('Unread')).toBeNull();
  });
});
