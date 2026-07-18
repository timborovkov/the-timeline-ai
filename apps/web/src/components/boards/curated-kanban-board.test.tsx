// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render as testingRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type { PropsWithChildren, ReactElement } from 'react';

const fakes = vi.hoisted(() => ({ loadTaskCategoryStatesAction: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ updateBoardItemAction: vi.fn() }));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
}));

const { CuratedKanbanBoard } = await import('./curated-kanban-board.js');

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return testingRender(ui, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function lane(): boards.BoardLaneRow {
  return {
    id: 'lane-1',
    boardId: 'board-1',
    name: 'Open',
    position: 0,
    kind: 'active',
    archivedAt: null,
  };
}

function boardItem(
  canonicalName: string,
  metadata: Record<string, unknown> = {},
): boards.BoardItemRow {
  return {
    id: 'item-1',
    boardId: 'board-1',
    entityId: 'object-1',
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
      id: 'object-1',
      canonicalName,
      type: 'task',
      aliases: [],
      status: 'todo',
      stage: null,
      priority: null,
      ownerUserId: null,
      assigneeUserId: null,
      dueAt: null,
      metadata,
      agentSuggested: false,
      taskCategory: null,
      taskCategoryMode: null,
      taskCategorySource: null,
      taskCategoryStatus: null,
      taskCategoryUpdatedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };
}

describe('CuratedKanbanBoard', () => {
  beforeEach(() => {
    cleanup();
    fakes.loadTaskCategoryStatesAction.mockReset();
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({ rows: [] });
  });

  it('wraps long card titles', () => {
    const longTitle =
      'timborovkov/the-timeline-ai#202: Add cursor pagination to the visible sales pipeline so full titles remain readable';

    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[boardItem(longTitle)]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const title = screen.getByRole('link', { name: longTitle });
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
  });

  it('updates a pending task category on the card', async () => {
    fakes.loadTaskCategoryStatesAction.mockResolvedValue({
      rows: [
        {
          id: 'object-1',
          taskCategory: 'design',
          taskCategoryStatus: 'ready',
          taskCategoryUpdatedAt: new Date('2026-07-13T10:00:00.000Z'),
        },
      ],
    });
    const item = boardItem('Pending category');
    item.object.taskCategoryStatus = 'pending';

    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[item]}
        selectedItemId={null}
        members={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Design')).toBeTruthy();
    });
    expect(screen.queryByText('Categorizing…')).toBeNull();
  });

  it('uses source-tracked integration display titles on cards', () => {
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[
          boardItem('timborovkov/the-timeline-ai#202: Add cursor pagination', {
            display_title: 'the-timeline-ai: Add cursor pagination',
            display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
          }),
        ]}
        selectedItemId={null}
        members={[]}
      />,
    );

    expect(
      screen.getByRole('link', { name: 'the-timeline-ai: Add cursor pagination' }),
    ).toBeTruthy();
    expect(screen.queryByText(/timborovkov\/the-timeline-ai#202/)).toBeNull();
  });
});
