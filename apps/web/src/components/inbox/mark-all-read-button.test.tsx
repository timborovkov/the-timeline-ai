import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  refresh: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({
    markAllNotificationsReadAction: fakes.markAllRead,
  }),
  () => import('@/app/actions/objects'),
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
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

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

    await waitFor(() => {
      expect(fakes.markAllRead).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark all read' }).hasAttribute('disabled')).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

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
