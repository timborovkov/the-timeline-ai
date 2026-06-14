// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/boards/board-add-item-form', () => ({
  BoardAddItemForm: (props: {
    onOptimisticItem?: (item: boards.BoardItemRow) => void;
    onItemAdded?: (item: boards.BoardItemRow, optimisticId: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.onOptimisticItem?.({
          id: 'optimistic-item-2',
          boardId: 'board-1',
          entityId: 'object-2',
          laneId: 'lane-1',
          position: 0,
          responsibleUserId: null,
          dueAt: null,
          priority: null,
          nextStep: null,
          notes: null,
          customFields: {},
          archivedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          object: {
            id: 'object-2',
            canonicalName: 'Beta',
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
          },
        });
      }}
    >
      Fake optimistic add
    </button>
  ),
}));
vi.mock('@/components/boards/board-card-detail', () => ({
  BoardCardDetail: () => null,
}));
vi.mock('@/components/boards/board-actions-menu', () => ({
  BoardActionsMenu: () => <button type="button">Board actions</button>,
}));
vi.mock('@/components/boards/curated-kanban-board', () => ({
  CuratedKanbanBoard: () => null,
}));

const { BoardDetailClient } = await import('./board-detail-client.js');
const { CuratedBoardList, CuratedBoardTable } = await import('./curated-board-views.js');

function objectRow(input: { id: string; canonicalName: string }): objects.ObjectRow {
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

function boardItem(input: {
  id: string;
  entityId: string;
  canonicalName: string;
}): boards.BoardItemRow {
  return {
    id: input.id,
    boardId: 'board-1',
    entityId: input.entityId,
    laneId: 'lane-1',
    position: 0,
    responsibleUserId: null,
    dueAt: null,
    priority: null,
    nextStep: null,
    notes: null,
    customFields: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    object: objectRow({ id: input.entityId, canonicalName: input.canonicalName }),
  };
}

function renderClient(items: boards.BoardItemRow[]) {
  return (
    <BoardDetailClient
      boardId="board-1"
      boardName="Pilot board"
      purpose="Track pilots"
      pinned={false}
      view="list"
      lanes={[]}
      initialItems={items}
      initialCandidates={[]}
      recommendedTypes={['company']}
      defaultLaneId="lane-1"
      selectedItemId={null}
      history={[]}
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
