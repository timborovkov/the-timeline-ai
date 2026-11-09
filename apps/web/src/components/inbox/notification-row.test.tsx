import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  refresh: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({
    markAllNotificationsReadAction: fakes.markAllRead,
    markNotificationReadAction: fakes.markRead,
  }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/notify'),
  async () => ({
    ...(await import('@/lib/notify')),
    notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
      try {
        return await run();
      } catch {
        return { error: 'failed' };
      }
    },
  }),
  () => import('@/lib/notify'),
);

const {
  cleanup,
  render: renderWithoutProvider,
  screen,
  waitFor,
} = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { InboxReadProvider } = await import('@/components/inbox/inbox-read-state');
const render = (ui: ReactElement, options?: RenderOptions) =>
  renderWithoutProvider(ui, { wrapper: InboxReadProvider, ...options });

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

    render(
      <ul>
        <NotificationRow
          id="notification-1"
          kind="agent_suggestion"
          summary="Review the launch plan"
          entityId="object-1"
          agentSuggestionId={null}
          createdAt="2026-07-29T12:00:00.000Z"
          initiallyRead={false}
        />
      </ul>,
    );

    const link = screen.getByRole('link', { name: 'Review the launch plan' });
    await user.click(link);
    await user.click(link);

    expect(fakes.markRead).toHaveBeenCalledTimes(1);
    resolveAction({ ok: true });
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('restores unread after a failed Mark all read, but keeps a successful individual read', async () => {
    const user = userEvent.setup();
    fakes.markAllRead.mockResolvedValue({ error: 'Database unavailable' });
    fakes.markRead.mockResolvedValue({ ok: true });

    const { rerender } = render(
      <>
        <MarkAllReadButton hasUnread />
        <ul>
          <NotificationRow
            id="notification-1"
            kind="agent_suggestion"
            summary="Keep this row"
            entityId={null}
            agentSuggestionId={null}
            createdAt="2026-07-29T12:00:00.000Z"
            initiallyRead={false}
          />
          <NotificationRow
            id="notification-2"
            kind="agent_suggestion"
            summary="Roll this row back"
            entityId={null}
            agentSuggestionId={null}
            createdAt="2026-07-29T12:00:00.000Z"
            initiallyRead={false}
          />
        </ul>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Mark Keep this row as read' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Mark Keep this row as read' })).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(
      await screen.findByRole('button', { name: 'Mark Roll this row back as read' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark Keep this row as read' })).toBeNull();
    expect(fakes.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <MarkAllReadButton hasUnread />
        <ul>
          <NotificationRow
            id="notification-1"
            kind="agent_suggestion"
            summary="Keep this row"
            entityId={null}
            agentSuggestionId={null}
            createdAt="2026-07-29T12:00:00.000Z"
            initiallyRead={false}
          />
          <NotificationRow
            id="notification-2"
            kind="agent_suggestion"
            summary="Roll this row back"
            entityId={null}
            agentSuggestionId={null}
            createdAt="2026-07-29T12:00:00.000Z"
            initiallyRead={false}
          />
        </ul>
      </>,
    );

    expect(screen.queryByRole('button', { name: 'Mark Keep this row as read' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark Roll this row back as read' })).toBeTruthy();
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

describe('inbox read scope', () => {
  it('applies pending bulk state to newly mounted rows without changing another inbox', async () => {
    let finish!: (value: { error: string }) => void;
    fakes.markAllRead.mockReturnValue(
      new Promise<{ error: string }>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    const row = (id: string) => (
      <NotificationRow
        id={id}
        kind="agent_suggestion"
        summary={id}
        entityId={null}
        agentSuggestionId={null}
        createdAt="2026-07-29T12:00:00.000Z"
        initiallyRead={false}
      />
    );
    const view = renderWithoutProvider(
      <>
        <InboxReadProvider>
          <MarkAllReadButton hasUnread />
          <ul>{row('first')}</ul>
        </InboxReadProvider>
        <InboxReadProvider>
          <ul>{row('other scope')}</ul>
        </InboxReadProvider>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    view.rerender(
      <>
        <InboxReadProvider>
          <MarkAllReadButton hasUnread />
          <ul>
            {row('first')}
            {row('late row')}
          </ul>
        </InboxReadProvider>
        <InboxReadProvider>
          <ul>{row('other scope')}</ul>
        </InboxReadProvider>
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Mark late row as read' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark other scope as read' })).toBeTruthy();
    finish({ error: 'failed' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mark first as read' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Mark late row as read' })).toBeTruthy();
    });
  });
});

describe('inbox server reconciliation', () => {
  it('clears completed bulk optimism when a refreshed server snapshot contains unread rows', async () => {
    fakes.markAllRead.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const row = (
      <NotificationRow
        id="new-notification"
        kind="agent_suggestion"
        summary="New notification"
        entityId={null}
        agentSuggestionId={null}
        createdAt="2026-07-29T12:00:00.000Z"
        initiallyRead={false}
      />
    );
    const view = renderWithoutProvider(
      <InboxReadProvider snapshot={{ version: 1 }}>
        <MarkAllReadButton hasUnread />
        <ul>{row}</ul>
      </InboxReadProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Unread')).toBeNull();
    view.rerender(
      <InboxReadProvider snapshot={{ version: 2 }}>
        <MarkAllReadButton hasUnread />
        <ul>{row}</ul>
      </InboxReadProvider>,
    );
    expect(screen.getByText('Unread')).toBeTruthy();
  });
});
