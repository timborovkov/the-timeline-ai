// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type { PropsWithChildren, ReactElement, ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  loadTaskCategoryStatesAction: vi.fn(),
  updateBoardItemAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ updateBoardItemAction: fakes.updateBoardItemAction }));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
    try {
      return await run();
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'failed' };
    }
  },
}));
vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: fakes.loadTaskCategoryStatesAction,
}));
vi.mock('@/components/collections/virtual-list', () => ({
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

function lane(id = 'lane-1', name = 'Open'): boards.BoardLaneRow {
  return {
    id,
    boardId: 'board-1',
    name,
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
    fakes.updateBoardItemAction.mockReset();
    fakes.updateBoardItemAction.mockResolvedValue({ ok: true, id: 'item-1' });
  });

  it('groups the scrollable board columns with uniquely named duplicate lane regions', () => {
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane('lane-1', 'Open'), lane('lane-2', 'Open')]}
        items={[boardItem('Board card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const boardColumns = screen.getByRole('region', { name: 'Board columns' });
    expect(within(boardColumns).getByRole('region', { name: 'Open, board column 1' })).toBeTruthy();
    expect(within(boardColumns).getByRole('region', { name: 'Open, board column 2' })).toBeTruthy();
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

  it('identifies the card open in the detail panel as current', () => {
    const firstCard = boardItem('Open card');
    const secondCard = boardItem('Other card');
    secondCard.id = 'item-2';
    secondCard.entityId = 'object-2';
    secondCard.object.id = 'object-2';

    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[firstCard, secondCard]}
        selectedItemId="item-1"
        members={[]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Open card' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByRole('link', { name: 'Other card' }).hasAttribute('aria-current')).toBe(
      false,
    );
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

  it('renders an unassigned item in the Unset lane', () => {
    const unassignedItem = boardItem('Unassigned card');
    unassignedItem.laneId = null;

    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[unassignedItem]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const unsetColumn = screen.getByRole('heading', { name: 'Unset' }).parentElement?.parentElement;
    if (!unsetColumn) {
      throw new Error('Expected the Unset lane to render');
    }
    expect(within(unsetColumn).getByRole('link', { name: 'Unassigned card' })).toBeTruthy();
  });

  it('activates the card title link with Enter without starting a drag', async () => {
    const user = userEvent.setup();
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[boardItem('Keyboard link card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const title = screen.getByRole<HTMLAnchorElement>('link', { name: 'Keyboard link card' });
    const titleClick = vi.fn((event: Event) => {
      event.preventDefault();
    });
    title.addEventListener('click', titleClick);
    title.focus();

    await user.keyboard('{Enter}');

    expect(titleClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Picked up Keyboard link card/)).toBeNull();
  });

  it('keeps a keyboard-operable drag handle with live announcements', async () => {
    const user = userEvent.setup();
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[boardItem('Keyboard drag card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const dragHandle = screen.getByRole('button', { name: /Drag Keyboard drag card/ });
    dragHandle.focus();

    await user.keyboard('[Space]');
    await waitFor(() => {
      expect(dragHandle.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('status').textContent).toContain('Keyboard drag card is over Open.');
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        'Cancelled moving Keyboard drag card.',
      );
    });
  });

  it('keeps keyboard drag as the only on-card move path', async () => {
    const user = userEvent.setup();
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane(), lane('lane-2', 'Doing')]}
        items={[boardItem('Keyboard card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const title = screen.getByRole('link', { name: 'Keyboard card' });
    const dragHandle = screen.getByRole('button', { name: /Drag Keyboard card/ });
    expect(dragHandle.getAttribute('aria-label')).toContain('Press Space or Enter to pick up');
    expect(screen.queryByRole('button', { name: 'Lane for Keyboard card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.queryByText('Move')).toBeNull();
    expect(screen.getByText(/To change lane without dragging, open the card/)).toBeTruthy();

    title.focus();
    await user.tab();
    expect(document.activeElement).toBe(dragHandle);
  });

  it('places the next step under the title and hides empty next-step chrome', () => {
    const withStep = boardItem('Has next step');
    withStep.nextStep = 'Send security appendix to legal for final read.';
    const withoutStep = boardItem('No next step card');
    withoutStep.id = 'item-2';
    withoutStep.entityId = 'object-2';
    withoutStep.object.id = 'object-2';

    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane()]}
        items={[withStep, withoutStep]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const titledCard = screen.getByRole('link', { name: 'Has next step' }).closest('article');
    if (!titledCard) throw new Error('Expected the titled card');
    const titleBlock = titledCard.querySelector('div.min-w-0.flex-1');
    expect(titleBlock?.textContent).toContain('Has next step');
    expect(titleBlock?.textContent).toContain('Send security appendix to legal for final read.');
    expect(screen.queryByText('No next step')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next step for Has next step' })).toBeNull();
    expect(screen.queryByText('Saving…')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
  });
});
