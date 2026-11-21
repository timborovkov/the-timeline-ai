import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({
    markAllNotificationsReadAction: fakes.markAllRead,
  }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.refresh, push: fakes.push }),
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
await vi.mock(
  import.meta.resolve('@/components/workspace-timezone-context'),
  () => ({ useWorkspaceTimezone: () => 'UTC' }),
  () => import('@/components/workspace-timezone-context'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

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
  vi.unstubAllGlobals();
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

    expect(screen.queryByRole('alert')).toBeNull();
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

  it('keeps the native link usable while the read update is pending or fails', async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<InboxBell unreadCount={1} notifications={[notification]} />);
    await user.click(screen.getByRole('button', { name: 'Open inbox, 1 unread' }));
    const item = screen.getByRole('link', { name: /Review the launch plan/i });
    expect(item.getAttribute('href')).toBe('/app/inbox');
    await user.click(item);
    expect(item.getAttribute('aria-disabled')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`/api/inbox/${notification.id}/read`, {
      method: 'POST',
      keepalive: true,
    });

    finish(new Response(null, { status: 503 }));
    await waitFor(() => {
      expect(fakes.refresh).not.toHaveBeenCalled();
      expect(item.getAttribute('href')).toBe('/app/inbox');
    });
  });
});
