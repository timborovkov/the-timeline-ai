// @vitest-environment happy-dom

// Pin controls are shared across every work surface. These tests guard their
// optimistic state, rollback, and Home-preview removal contract.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PinnedItem } from '@timeline/shared/pins';

const fakes = vi.hoisted(() => ({
  pinTargetAction: vi.fn(),
  unpinTargetAction: vi.fn(),
  notifyAction: vi.fn(async (options: { run: () => Promise<{ error?: string }> }) => options.run()),
}));

vi.mock('@/app/actions/pins', () => ({
  pinTargetAction: fakes.pinTargetAction,
  unpinTargetAction: fakes.unpinTargetAction,
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: fakes.notifyAction,
}));

const { PinButton } = await import('@/components/pins/pin-button');
const { PinnedWorkspacePreview } = await import('@/components/pins/pinned-workspace-preview');

const pinnedItem: PinnedItem = {
  pinId: '11111111-1111-4111-8111-111111111111',
  target: { kind: 'object', key: '11111111-1111-4111-8111-111111111111' },
  title: 'Launch plan',
  subtitle: 'Project · active',
  href: '/app/objects/11111111-1111-4111-8111-111111111111',
  iconKind: 'project',
  sortKey: '0',
  pinnedAt: '2026-07-31T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  fakes.pinTargetAction.mockResolvedValue({ ok: true });
  fakes.unpinTargetAction.mockResolvedValue({ ok: true });
  fakes.notifyAction.mockImplementation(
    async ({ run }: { run: () => Promise<{ error?: string }> }) => {
      try {
        return await run();
      } catch {
        return { error: 'failed' };
      }
    },
  );
});

afterEach(cleanup);

describe('shared pin controls', () => {
  it('pins from the keyboard with an exposed pressed state', async () => {
    const user = userEvent.setup();
    render(<PinButton target={pinnedItem.target} initialPinned={false} />);

    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    pin.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(fakes.pinTargetAction).toHaveBeenCalledWith(pinnedItem.target);
      expect(screen.getByRole('button', { name: 'Unpin' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
    });
  });

  it('restores a direct pin control and announces a failed mutation', async () => {
    const user = userEvent.setup();
    fakes.pinTargetAction.mockResolvedValue({ error: 'That item is not available to pin.' });
    render(<PinButton target={pinnedItem.target} initialPinned={false} />);

    await user.click(screen.getByRole('button', { name: 'Pin' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pin' }).getAttribute('aria-pressed')).toBe(
        'false',
      );
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Couldn’t pin item' }),
      );
    });
  });

  it('keeps a Home preview item until its unpin action succeeds', async () => {
    const user = userEvent.setup();
    let resolveUnpin: ((value: { ok: true }) => void) | undefined;
    fakes.unpinTargetAction.mockReturnValue(
      new Promise((resolve) => {
        resolveUnpin = resolve;
      }),
    );
    render(<PinnedWorkspacePreview initialItems={[pinnedItem]} />);

    await user.click(screen.getByRole('button', { name: 'Actions for Launch plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Unpin Launch plan' }));

    expect(screen.getByText('Launch plan')).toBeTruthy();
    const pendingUnpin = screen.getByRole('menuitem', { name: 'Saving unpin… Launch plan' });
    expect(pendingUnpin.getAttribute('aria-busy')).toBe('true');
    expect(pendingUnpin.hasAttribute('data-disabled')).toBe(true);
    resolveUnpin?.({ ok: true });

    await waitFor(() => {
      expect(screen.queryByLabelText('Pinned work')).toBeNull();
    });
  });

  it('keeps a Home preview item when its unpin action fails', async () => {
    const user = userEvent.setup();
    fakes.unpinTargetAction.mockResolvedValue({ error: 'Could not unpin that item.' });
    render(<PinnedWorkspacePreview initialItems={[pinnedItem]} />);

    await user.click(screen.getByRole('button', { name: 'Actions for Launch plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Unpin Launch plan' }));

    await waitFor(() => {
      expect(screen.getByText('Launch plan')).toBeTruthy();
      expect(fakes.notifyAction).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Couldn’t unpin item' }),
      );
    });
  });
});
