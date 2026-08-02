// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type { PropsWithChildren, ReactElement } from 'react';

const fakes = vi.hoisted(() => ({
  loadTaskCategoryStatesAction: vi.fn(),
  updateBoardItemAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ updateBoardItemAction: fakes.updateBoardItemAction }));
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

    const dragHandle = screen.getByRole('button', { name: 'Drag Keyboard drag card' });
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

  it('keeps Move to lane keyboard-reachable beside the drag handle and restores focus', async () => {
    const user = userEvent.setup();
    let resolveMove!: (value: { ok: true; id: string }) => void;
    fakes.updateBoardItemAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane(), lane('lane-2', 'Doing')]}
        items={[boardItem('Keyboard card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const moveControl = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Move to lane' });
    const title = screen.getByRole('link', { name: 'Keyboard card' });
    const dragHandle = screen.getByRole('button', { name: 'Drag Keyboard card' });
    title.focus();
    await user.tab();
    expect(document.activeElement).toBe(dragHandle);
    await user.tab();
    expect(document.activeElement).toBe(moveControl);
    expect(moveControl.className).toContain('w-full');
    expect(moveControl.className).toContain('text-base');
    expect(screen.getByText(/To move directly between lanes with the keyboard/)).toBeTruthy();

    await user.selectOptions(moveControl, 'lane-2');

    await waitFor(() => {
      expect(fakes.updateBoardItemAction).toHaveBeenCalledWith({ id: 'item-1', laneId: 'lane-2' });
      const movedControl = screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Move to lane',
      });
      expect(movedControl.value).toBe('lane-2');
      expect(movedControl.disabled).toBe(true);
      expect(screen.getByText('Saving…')).toBeTruthy();
    });

    resolveMove({ ok: true, id: 'item-1' });
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
      const savedControl = screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Move to lane',
      });
      expect(savedControl.disabled).toBe(false);
      expect(document.activeElement).toBe(savedControl);
    });
  });

  it('disables Move to lane and announces saving while its update is pending', async () => {
    const user = userEvent.setup();
    let resolveMove!: (value: { ok: true; id: string }) => void;
    fakes.updateBoardItemAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane(), lane('lane-2', 'Doing'), lane('lane-3', 'Done')]}
        items={[boardItem('Pending move card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    await user.selectOptions(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Move to lane' }),
      'lane-2',
    );

    await waitFor(() => {
      const pendingControl = screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Move to lane',
      });
      expect(pendingControl.disabled).toBe(true);
      expect(screen.getByText('Saving…')).toBeTruthy();
    });
    expect(fakes.updateBoardItemAction).toHaveBeenCalledOnce();

    resolveMove({ ok: true, id: 'item-1' });
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('announces a failed lane move and lets the keyboard user recover', async () => {
    const user = userEvent.setup();
    fakes.updateBoardItemAction
      .mockResolvedValueOnce({ error: 'The board could not be updated.' })
      .mockResolvedValueOnce({ ok: true, id: 'item-1' });
    render(
      <CuratedKanbanBoard
        boardId="board-1"
        lanes={[lane(), lane('lane-2', 'Doing')]}
        items={[boardItem('Recovery card')]}
        selectedItemId={null}
        members={[]}
      />,
    );

    const moveControl = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Move to lane' });
    await user.selectOptions(moveControl, 'lane-2');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Unable to move Recovery card.');
    expect(alert.textContent).toContain('Choose a lane to try again.');
    const recoveredControl = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Move to lane',
    });
    expect(recoveredControl.getAttribute('aria-invalid')).toBe('true');
    expect(recoveredControl.getAttribute('aria-describedby')).toContain('move-error');
    expect(document.activeElement).toBe(recoveredControl);

    await user.selectOptions(recoveredControl, 'lane-2');
    await waitFor(() => {
      expect(fakes.updateBoardItemAction).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
