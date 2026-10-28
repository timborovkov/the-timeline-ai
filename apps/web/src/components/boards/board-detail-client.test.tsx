import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';
import type { ReactNode } from 'react';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/boards'),
  () => ({
    updateBoardItemAction: vi.fn(() => Promise.resolve({ ok: true })),
  }),
  () => import('@/app/actions/boards'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/objects'),
  () => ({
    // Bun links all named exports, including actions this suite must never invoke.
    searchAddableObjectsAction: vi.fn(() => {
      throw new Error('Unexpected searchAddableObjectsAction call in this test');
    }),
    loadTaskRowsAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskRowsAction call in this test');
    }),
    loadObjectRowsAction: vi.fn(() => {
      throw new Error('Unexpected loadObjectRowsAction call in this test');
    }),
    createObjectAction: vi.fn(() => {
      throw new Error('Unexpected createObjectAction call in this test');
    }),
    updateObjectAction: vi.fn(() => {
      throw new Error('Unexpected updateObjectAction call in this test');
    }),
    setTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected setTaskCategoryAction call in this test');
    }),
    undoTaskCategoryChangeAction: vi.fn(() => {
      throw new Error('Unexpected undoTaskCategoryChangeAction call in this test');
    }),
    resetTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected resetTaskCategoryAction call in this test');
    }),
    retryTaskCategoryAction: vi.fn(() => {
      throw new Error('Unexpected retryTaskCategoryAction call in this test');
    }),
    setTaskProjectAction: vi.fn(() => {
      throw new Error('Unexpected setTaskProjectAction call in this test');
    }),
    updateObjectMetadataAction: vi.fn(() => {
      throw new Error('Unexpected updateObjectMetadataAction call in this test');
    }),
    createIdentityFacetAction: vi.fn(() => {
      throw new Error('Unexpected createIdentityFacetAction call in this test');
    }),
    archiveIdentityFacetAction: vi.fn(() => {
      throw new Error('Unexpected archiveIdentityFacetAction call in this test');
    }),
    setPersonCompanyAction: vi.fn(() => {
      throw new Error('Unexpected setPersonCompanyAction call in this test');
    }),
    structureContactFromBoardNotesAction: vi.fn(() => {
      throw new Error('Unexpected structureContactFromBoardNotesAction call in this test');
    }),
    loadTaskCategoryFilterStateAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskCategoryFilterStateAction call in this test');
    }),
    loadTaskPrimaryProjectsAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskPrimaryProjectsAction call in this test');
    }),
    unarchiveObjectAction: vi.fn(() => {
      throw new Error('Unexpected unarchiveObjectAction call in this test');
    }),
    archiveObjectAction: vi.fn(() => {
      throw new Error('Unexpected archiveObjectAction call in this test');
    }),
    pinObjectAction: vi.fn(() => {
      throw new Error('Unexpected pinObjectAction call in this test');
    }),
    unpinObjectAction: vi.fn(() => {
      throw new Error('Unexpected unpinObjectAction call in this test');
    }),
    bulkArchiveObjectsAction: vi.fn(() => {
      throw new Error('Unexpected bulkArchiveObjectsAction call in this test');
    }),
    mergeObjectsAction: vi.fn(() => {
      throw new Error('Unexpected mergeObjectsAction call in this test');
    }),
    findObjectCleanupSuggestionsAction: vi.fn(() => {
      throw new Error('Unexpected findObjectCleanupSuggestionsAction call in this test');
    }),
    repairObjectMemoryAction: vi.fn(() => {
      throw new Error('Unexpected repairObjectMemoryAction call in this test');
    }),
    addRelationshipAction: vi.fn(() => {
      throw new Error('Unexpected addRelationshipAction call in this test');
    }),
    removeRelationshipAction: vi.fn(() => {
      throw new Error('Unexpected removeRelationshipAction call in this test');
    }),
    createNoteAction: vi.fn(() => {
      throw new Error('Unexpected createNoteAction call in this test');
    }),
    updateNoteAction: vi.fn(() => {
      throw new Error('Unexpected updateNoteAction call in this test');
    }),
    deleteNoteAction: vi.fn(() => {
      throw new Error('Unexpected deleteNoteAction call in this test');
    }),
    generateObjectSummaryAction: vi.fn(() => {
      throw new Error('Unexpected generateObjectSummaryAction call in this test');
    }),
    markNotificationReadAction: vi.fn(() => {
      throw new Error('Unexpected markNotificationReadAction call in this test');
    }),
    markAllNotificationsReadAction: vi.fn(() => {
      throw new Error('Unexpected markAllNotificationsReadAction call in this test');
    }),
    acceptObjectChangeAction: vi.fn(() => {
      throw new Error('Unexpected acceptObjectChangeAction call in this test');
    }),
    rejectObjectChangeAction: vi.fn(() => {
      throw new Error('Unexpected rejectObjectChangeAction call in this test');
    }),
    loadTaskCategoryStatesAction: vi.fn(() => {
      throw new Error('Unexpected loadTaskCategoryStatesAction call in this test');
    }),
    searchObjectsAction: vi.fn(),
  }),
  () => import('@/app/actions/objects'),
);
await vi.mock(
  import.meta.resolve('@/components/boards/board-add-item-form'),
  () => ({
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
          <button type="button">Add item</button>
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
  }),
  () => import('@/components/boards/board-add-item-form'),
);
await vi.mock(
  import.meta.resolve('@/components/boards/board-card-detail'),
  () => ({
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
  }),
  () => import('@/components/boards/board-card-detail'),
);
await vi.mock(
  import.meta.resolve('@/components/boards/board-actions-menu'),
  () => ({
    BoardActionsMenu: (props: { purpose: string }) => (
      <output aria-label="board settings purpose">{props.purpose}</output>
    ),
  }),
  () => import('@/components/boards/board-actions-menu'),
);
await vi.mock(
  import.meta.resolve('@/components/boards/curated-kanban-board'),
  () => ({
    CuratedKanbanBoard: () => null,
  }),
  () => import('@/components/boards/curated-kanban-board'),
);
await vi.mock(
  import.meta.resolve('@/components/collections/virtual-list'),
  () => ({
    VirtualList: ({
      items,
      renderItem,
      getItemKey,
    }: {
      items: { id: string }[];
      renderItem: (item: { id: string }, index: number) => ReactNode;
      getItemKey: (item: { id: string }, index: number) => string;
    }) =>
      createElement(
        'div',
        null,
        items.map((item, index) =>
          createElement('div', { key: getItemKey(item, index) }, renderItem(item, index)),
        ),
      ),
  }),
  () => import('@/components/collections/virtual-list'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const { BoardDetailClient } = await import('./board-detail-client.js');
const { CuratedBoardList } = await import('./curated-board-views.js');

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
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
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
    view?: 'kanban' | 'list';
    purpose?: string;
    itemCount?: number;
  } = {},
) {
  return (
    <BoardDetailClient
      boardId="board-1"
      boardName="Pilot board"
      purpose={options.purpose ?? 'Track pilots'}
      pinned={false}
      itemCount={options.itemCount}
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

    const heading = screen.getByRole('heading', { level: 1, name: 'Pilot board' });
    expect(heading.className).not.toContain('uppercase');
    expect(heading.parentElement?.textContent).toContain('Track pilots');
    expect(screen.getByRole('link', { name: 'Boards' }).getAttribute('aria-current')).toBe('page');
    const search = screen.getByLabelText('Search');
    const view = screen.getByRole('navigation', { name: 'Board view' });
    const addItem = screen.getByRole('button', { name: 'Add item' });
    expect(search.closest('.flex.min-h-11')).toBe(view.closest('.flex.min-h-11'));
    expect(addItem.closest('.flex.min-h-11')).toBe(view.closest('.flex.min-h-11'));
    expect(screen.getByRole('link', { name: 'list' }).getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('button', { name: 'Fake optimistic add' }));

    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Pilot board' })).toBeTruthy();
    });
  });

  it('shows the server filtered item count in the board filter bar', () => {
    render(
      <BoardDetailClient
        boardId="board-1"
        boardName="Pilot board"
        purpose="Track pilots"
        pinned={false}
        itemCount={8}
        view="list"
        lanes={[]}
        initialItems={[
          boardItem({
            id: 'item-1',
            entityId: 'object-1',
            canonicalName: 'Alpha',
          }),
        ]}
        initialCandidates={[]}
        recommendedTypes={['company']}
        defaultLaneId="lane-1"
        selectedItemId={null}
        history={[]}
        members={[]}
        activeFilters
      />,
    );

    expect(screen.getByText('1 of 8')).toBeTruthy();
  });

  it('does not resurrect a locally committed add after it is removed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      renderClient([], {
        selectedItemId: 'item-2',
        view: 'list',
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
        view: 'list',
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
        { selectedItemId: 'item-1', view: 'list' },
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Set P1' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Priority for Alpha' }).textContent).toContain(
        'P1',
      );
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
        { selectedItemId: 'item-1', view: 'list' },
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Priority for Alpha' }).textContent).toContain(
        'P1',
      );
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
        { selectedItemId: 'item-1', view: 'list' },
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Priority for Alpha' }).textContent).toContain(
        'P2',
      );
    });
  });

  it('does not link optimistic list rows to temporary ids', () => {
    const items = [
      boardItem({
        id: 'optimistic-object-1',
        entityId: 'object-1',
        canonicalName: 'Pending company',
      }),
    ];

    const list = renderToStaticMarkup(
      <CuratedBoardList boardId="board-1" view="list" items={items} />,
    );

    expect(list).toContain('Pending company');
    expect(list).not.toContain('optimistic-object-1');
  });
});
