// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PinnedItem } from '@timeline/shared/pins';
import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  movePinAction: vi.fn(),
  pinTargetAction: vi.fn(),
  unpinTargetAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fakes.refresh }),
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => run(),
  notifyError: vi.fn(),
}));
vi.mock('@/app/actions/pins', () => ({
  movePinAction: fakes.movePinAction,
  pinTargetAction: fakes.pinTargetAction,
  unpinTargetAction: fakes.unpinTargetAction,
}));
vi.mock('@/components/collections/virtual-list', () => ({
  VirtualList: ({
    items,
    renderItem,
    getItemKey,
  }: {
    items: { pinId: string }[];
    renderItem: (item: { pinId: string }, index: number) => ReactNode;
    getItemKey: (item: { pinId: string }, index: number) => string;
  }) =>
    createElement(
      'div',
      null,
      items.map((item, index) =>
        createElement('div', { key: getItemKey(item, index) }, renderItem(item, index)),
      ),
    ),
}));

const { PinnedWorkspaceManager } = await import('@/components/pins/pinned-workspace-manager');

function pin(id: string, title: string, sortKey: string): PinnedItem {
  return {
    pinId: id,
    target: { kind: 'object', key: id },
    title,
    subtitle: 'Project · active',
    href: `/app/objects/${id}`,
    iconKind: 'project',
    sortKey,
    pinnedAt: '2026-07-20T10:00:00.000Z',
  };
}

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.movePinAction.mockResolvedValue({ ok: true });
  fakes.pinTargetAction.mockResolvedValue({ ok: true });
  fakes.unpinTargetAction.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe('PinnedWorkspaceManager', () => {
  it('reorders the mixed collection with keyboard controls and announces the move', async () => {
    const user = userEvent.setup();
    render(
      <PinnedWorkspaceManager
        initialPage={{
          items: [pin(FIRST_ID, 'Alpha', '0'), pin(SECOND_ID, 'Beta', '1024')],
          nextCursor: null,
        }}
        filter="all"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    await user.click(screen.getByRole('button', { name: 'Move Beta up' }));

    await waitFor(() => {
      expect(fakes.movePinAction).toHaveBeenCalledWith({
        pinId: SECOND_ID,
        beforePinId: FIRST_ID,
      });
      expect(screen.getByText('Moved Beta')).toBeTruthy();
    });
    expect(
      screen.getAllByRole('link', { name: /Alpha|Beta/ }).map((link) => link.textContent),
    ).toEqual(['Beta', 'Alpha']);
    expect(screen.getAllByText('Project · active')).toHaveLength(4);
  });

  it('allows the last loaded item to move to the global bottom when another page exists', async () => {
    const user = userEvent.setup();
    render(
      <PinnedWorkspaceManager
        initialPage={{
          items: [pin(FIRST_ID, 'Alpha', '0'), pin(SECOND_ID, 'Beta', '1024')],
          nextCursor: 'next-page',
        }}
        filter="all"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reorder' }));
    const moveToBottom = screen.getByRole('button', { name: 'Move Beta to bottom' });
    expect(moveToBottom.hasAttribute('disabled')).toBe(false);
    await user.click(moveToBottom);

    await waitFor(() => {
      expect(fakes.movePinAction).toHaveBeenCalledWith({ pinId: SECOND_ID, edge: 'bottom' });
    });
  });

  it('does not expose reorder mode under a filtered view', () => {
    render(
      <PinnedWorkspaceManager
        initialPage={{ items: [pin(FIRST_ID, 'Alpha', '0')], nextCursor: null }}
        filter="objects"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();
  });

  it('does not render a bare inventory count next to the pin filters', () => {
    render(
      <PinnedWorkspaceManager
        initialPage={{ items: [pin(FIRST_ID, 'Alpha', '0')], nextCursor: null }}
        filter="all"
      />,
    );

    expect(screen.queryByText('1')).toBeNull();
    expect(document.querySelector('output')).toBeNull();
  });

  it('uses the shared empty state when there are no pins', () => {
    render(<PinnedWorkspaceManager initialPage={{ items: [], nextCursor: null }} filter="all" />);

    expect(screen.getByText('No pins yet')).toBeTruthy();
    expect(
      screen.getByText(
        'Pin an item from its detail page or overflow menu to keep it close on Home and Work.',
      ),
    ).toBeTruthy();
  });

  it('replaces loaded pins when the server filter page changes', () => {
    const { rerender } = render(
      <PinnedWorkspaceManager
        initialPage={{ items: [pin(FIRST_ID, 'Alpha', '0')], nextCursor: null }}
        filter="all"
      />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();

    rerender(
      <PinnedWorkspaceManager
        initialPage={{ items: [pin(SECOND_ID, 'Beta', '1024')], nextCursor: null }}
        filter="objects"
      />,
    );
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();
  });
});
