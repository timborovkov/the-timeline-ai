// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({
  updateBoardItemAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('@/components/boards/board-add-item-form', () => ({
  BoardAddItemForm: (props: {
    onOptimisticItem?: (item: boards.BoardItemRow) => void;
    onItemAdded?: (item: boards.BoardItemRow, optimisticId: string) => void;
  }) => {
    const optimisticItem = testBoardItem({
      id: 'optimistic-item-2',
      entityId: 'object-2',
      canonicalName: 'Beta',
    });
    const persistedItem = testBoardItem({
      id: 'item-2',
      entityId: 'object-2',
      canonicalName: 'Beta',
    });
    return (
      <>
        <button
          type="button"
          onClick={() => {
            props.onOptimisticItem?.(optimisticItem);
          }}
        >
          Fake optimistic add
        </button>
        <button
          type="button"
          onClick={() => {
            props.onOptimisticItem?.(optimisticItem);
            props.onItemAdded?.(persistedItem, optimisticItem.id);
          }}
        >
          Fake committed add
        </button>
      </>
    );
  },
}));
vi.mock('@/components/boards/board-card-detail', () => ({
  BoardCardDetail: (props: {
    item: boards.BoardItemRow | null;
    onUpdateItem?: (itemId: string, patch: { priority: number }) => Promise<unknown>;
    onItemRemoved?: (itemId: string, entityId: string) => void;
  }) =>
    props.item ? (
      <>
        <button
          type="button"
          onClick={() => {
            void props.onUpdateItem?.(props.item?.id ?? '', { priority: 1 });
          }}
        >
          Set P1
        </button>
        <button
          type="button"
          onClick={() => {
            if (props.item) props.onItemRemoved?.(props.item.id, props.item.entityId);
          }}
        >
          Remove local item
        </button>
      </>
    ) : null,
}));
vi.mock('@/components/boards/board-actions-menu', () => ({
  BoardActionsMenu: (props: { purpose: string }) => (
    <output aria-label="board settings purpose">{props.purpose}</output>
  ),
}));
vi.mock('@/components/boards/curated-kanban-board', () => ({
  CuratedKanbanBoard: () => null,
}));

const { BoardDetailClient } = await import('./board-detail-client.js');
const { CuratedBoardList, CuratedBoardTable } = await import('./curated-board-views.js');

function testObjectRow(input: { id: string; canonicalName: string }): objects.ObjectRow {
  return {
    id: input.id,
    canonicalName: input.canonicalName,
    type: 'company',
    aliases: [],
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function testBoardItem(input: {
  id: string;
  entityId: string;
  canonicalName: string;
  priority?: number | null;
  updatedAt?: Date | string;
}): boards.BoardItemRow {
  return {
    id: input.id,
    boardId: 'board-1',
    entityId: input.entityId,
    laneId: 'lane-1',
    position: 0,
    responsibleUserId: null,
    dueAt: null,
    priority: input.priority ?? null,
    nextStep: null,
    notes: null,
    customFields: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: (input.updatedAt ??
      new Date('2026-01-01T00:00:00.000Z')) as boards.BoardItemRow['updatedAt'],
    object: testObjectRow({ id: input.entityId, canonicalName: input.canonicalName }),
  };
}

function boardItem(input: {
  id: string;
  entityId: string;
  canonicalName: string;
  priority?: number | null;
  updatedAt?: Date | string;
}): boards.BoardItemRow {
  return testBoardItem(input);
}

function renderClient(
  items: boards.BoardItemRow[],
  options: {
    selectedItemId?: string | null;
    view?: 'kanban' | 'table' | 'list';
    purpose?: string;
  } = {},
) {
  return (
    <BoardDetailClient
      boardId="board-1"
      boardName="Pilot board"
      purpose={options.purpose ?? 'Track pilots'}
      pinned={false}
      view={options.view ?? 'list'}
      lanes={[]}
      initialItems={items}
      initialCandidates={[]}
      recommendedTypes={['company']}
      defaultLaneId="lane-1"
      selectedItemId={options.selectedItemId ?? null}
      history={[]}
      members={[]}
    />
  );
}

describe('BoardDetailClient', () => {
  beforeEach(() => {
    cleanup();
  });

  it('resets board item state when refreshed server props rerender the client island', async () => {
    const { rerender } = render(
      renderClient([
        boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
        }),
      ]),
    );

    expect(screen.getByText('Alpha')).toBeTruthy();

    rerender(
      renderClient([
        boardItem({
          id: 'item-2',
          entityId: 'object-2',
          canonicalName: 'Beta',
        }),
      ]),
    );

    await waitFor(() => {
      expect(screen.queryByText('Alpha')).toBeNull();
      expect(screen.getByText('Beta')).toBeTruthy();
    });
  });

  it('keeps the board header compact when an item is added optimistically', async () => {
    const user = userEvent.setup();
    render(
      renderClient([
        boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
        }),
      ]),
    );

    const header = screen.getByLabelText('Board · Pilot board');
    expect(header.textContent).toContain('BOARD');
    expect(header.textContent).toContain('Pilot board');
    expect(header.textContent).not.toContain('kind');
    expect(header.textContent).not.toContain('items');

    await user.click(screen.getByRole('button', { name: 'Fake optimistic add' }));

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(screen.getByLabelText('Board · Pilot board').textContent).not.toContain('items');
    });
  });

  it('does not resurrect a locally committed add after it is removed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      renderClient([], {
        selectedItemId: 'item-2',
        view: 'table',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Fake committed add' }));

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove local item' })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Remove local item' }));

    rerender(
      renderClient([], {
        selectedItemId: null,
        view: 'table',
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText('Beta')).toBeNull();
    });
  });

  it('passes hidden legacy descriptions through to board settings', () => {
    render(
      renderClient([], {
        purpose: 'Track companies, deals, or projects through staged progress.',
      }),
    );

    expect(screen.getByLabelText('board settings purpose').textContent).toBe(
      'Track companies, deals, or projects through staged progress.',
    );
  });

  it('retires optimistic item patches after refreshed props catch up', async () => {
    const refreshedAt = new Date(Date.now() + 1000);
    const { rerender } = render(
      renderClient(
        [
          boardItem({
            id: 'item-1',
            entityId: 'object-1',
            canonicalName: 'Alpha',
          }),
        ],
        { selectedItemId: 'item-1', view: 'table' },
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Set P1' }));

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Priority for Alpha').value).toBe('1');
    });

    rerender(
      renderClient(
        [
          boardItem({
            id: 'item-1',
            entityId: 'object-1',
            canonicalName: 'Alpha',
            priority: 1,
            updatedAt: refreshedAt.toISOString(),
          }),
        ],
        { selectedItemId: 'item-1', view: 'table' },
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Priority for Alpha').value).toBe('1');
    });

    rerender(
      renderClient(
        [
          boardItem({
            id: 'item-1',
            entityId: 'object-1',
            canonicalName: 'Alpha',
            priority: 2,
            updatedAt: new Date(refreshedAt.getTime() + 1000).toISOString(),
          }),
        ],
        { selectedItemId: 'item-1', view: 'table' },
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>('Priority for Alpha').value).toBe('2');
    });
  });

  it('does not link optimistic table or list rows to temporary ids', () => {
    const items = [
      boardItem({
        id: 'optimistic-object-1',
        entityId: 'object-1',
        canonicalName: 'Pending company',
      }),
    ];

    const table = renderToStaticMarkup(
      <CuratedBoardTable boardId="board-1" view="table" items={items} />,
    );
    const list = renderToStaticMarkup(
      <CuratedBoardList boardId="board-1" view="list" items={items} />,
    );

    expect(table).toContain('Pending company');
    expect(list).toContain('Pending company');
    expect(table).not.toContain('optimistic-object-1');
    expect(list).not.toContain('optimistic-object-1');
  });
});
