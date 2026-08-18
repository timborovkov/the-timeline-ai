// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type { ReactNode } from 'react';

const fakes = vi.hoisted(() => ({
  updateItem: vi.fn(),
}));

vi.mock('@/app/actions/objects', () => ({
  loadTaskCategoryStatesAction: vi.fn(),
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

const { CuratedBoardList, CuratedBoardTable } = await import('./curated-board-views.js');

function boardItem(
  input: Partial<boards.BoardItemRow['object']> = {},
  itemInput: Partial<Omit<boards.BoardItemRow, 'object'>> = {},
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
    ...itemInput,
    object: {
      id: 'object-1',
      canonicalName: 'Launch review',
      type: 'task',
      aliases: [],
      status: 'todo',
      stage: null,
      priority: null,
      ownerUserId: null,
      assigneeUserId: null,
      dueAt: null,
      metadata: {},
      agentSuggested: false,
      taskCategory: null,
      taskCategoryMode: null,
      taskCategorySource: null,
      taskCategoryStatus: null,
      taskCategoryUpdatedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...input,
    },
  };
}

const LANES: boards.BoardLaneRow[] = [
  {
    id: 'lane-1',
    boardId: 'board-1',
    name: 'Open',
    position: 0,
    kind: 'active',
    archivedAt: null,
  },
  {
    id: 'lane-2',
    boardId: 'board-1',
    name: 'Done',
    position: 1,
    kind: 'done',
    archivedAt: null,
  },
];

describe('CuratedBoardTable', () => {
  beforeEach(() => {
    cleanup();
    fakes.updateItem.mockReset();
    fakes.updateItem.mockResolvedValue({ ok: true });
  });

  it('edits board item fields inline', async () => {
    const user = userEvent.setup();
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={LANES}
        items={[boardItem()]}
        members={[{ id: 'user-1', label: 'Ada' }]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Responsible person for Launch review' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Responsible person' }),
      'user-1',
    );
    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', {
        responsibleUserId: 'user-1',
      });
    });

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Lane for Launch review' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lane' }), 'lane-2');
    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', { laneId: 'lane-2' });
    });
  });

  it('uses the same date-only due timestamp as the detail panel', async () => {
    const user = userEvent.setup();
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={[]}
        items={[boardItem()]}
        members={[]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Due date for Launch review' }));
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-07-04' },
    });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(fakes.updateItem).toHaveBeenCalledWith('item-1', {
      dueAt: new Date('2026-07-04T00:00:00.000Z'),
    });
  });

  it('uses source-tracked integration display titles in table rows', () => {
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={[]}
        items={[
          boardItem({
            canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
            metadata: {
              display_title: 'the-timeline-ai: Add cursor pagination',
              display_title_canonical_name:
                'timborovkov/the-timeline-ai#202: Add cursor pagination',
            },
          }),
        ]}
        members={[]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    expect(
      screen.getByRole('link', { name: 'the-timeline-ai: Add cursor pagination' }),
    ).toBeTruthy();
    expect(screen.queryByText(/timborovkov\/the-timeline-ai#202/)).toBeNull();
  });

  it('announces an inline save failure with the affected item name', async () => {
    const user = userEvent.setup();
    fakes.updateItem.mockResolvedValueOnce({ error: 'Connection lost' });
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={LANES}
        items={[boardItem()]}
        members={[{ id: 'user-1', label: 'Ada' }]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Responsible person for Launch review' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Responsible person' }),
      'user-1',
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Unable to save Launch review. Connection lost',
      );
    });
  });

  it('announces bulk update failures as errors', async () => {
    const user = userEvent.setup();
    fakes.updateItem.mockResolvedValueOnce({ error: 'Connection lost' });
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={LANES}
        items={[boardItem()]}
        members={[]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Launch review' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const alert = screen.getByText('1 of 1 updates failed.');
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.className).toContain('text-danger');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });
  });

  it('syncs the next step editor when refreshed item props change', async () => {
    const user = userEvent.setup();
    const item = { ...boardItem(), nextStep: 'Call customer' };
    const { rerender } = render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={[]}
        items={[item]}
        members={[]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Next step for Launch review' }));
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Next step for Launch review' }).value,
    ).toBe('Call customer');

    rerender(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={[]}
        items={[{ ...item, nextStep: null }]}
        members={[]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Next step for Launch review' }).value,
    ).toBe('');
  });

  it('bulk assigns selected board items in table view', async () => {
    const user = userEvent.setup();
    render(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={LANES}
        items={[
          boardItem({ canonicalName: 'Launch review' }, { id: 'item-1', entityId: 'object-1' }),
          boardItem(
            { id: 'object-2', canonicalName: 'Security review' },
            { id: 'item-2', entityId: 'object-2' },
          ),
        ]}
        members={[{ id: 'user-1', label: 'Ada' }]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Launch review' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Security review' }));
    await user.selectOptions(screen.getByLabelText('Bulk responsible person'), 'user-1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', {
        responsibleUserId: 'user-1',
      });
      expect(fakes.updateItem).toHaveBeenCalledWith('item-2', {
        responsibleUserId: 'user-1',
      });
    });
  });
});

describe('CuratedBoardList', () => {
  beforeEach(() => {
    cleanup();
    fakes.updateItem.mockReset();
    fakes.updateItem.mockResolvedValue({ ok: true });
  });

  it('wraps long board item titles', () => {
    const longTitle =
      'timborovkov/the-timeline-ai#202: Add cursor pagination to the visible sales pipeline so full titles remain readable';

    render(
      <CuratedBoardList
        boardId="board-1"
        view="list"
        items={[boardItem({ canonicalName: longTitle })]}
      />,
    );

    const title = screen.getByText(longTitle);
    expect(title.className).toContain('truncate');
  });

  it('bulk sets due dates for selected board items in list view', async () => {
    const user = userEvent.setup();
    render(
      <CuratedBoardList
        boardId="board-1"
        view="list"
        lanes={LANES}
        items={[
          boardItem({ canonicalName: 'Launch review' }, { id: 'item-1', entityId: 'object-1' }),
          boardItem(
            { id: 'object-2', canonicalName: 'Security review' },
            { id: 'item-2', entityId: 'object-2' },
          ),
        ]}
        members={[{ id: 'user-1', label: 'Ada' }]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Launch review' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Security review' }));
    await user.selectOptions(screen.getByLabelText('Bulk board field'), 'due');
    await user.type(screen.getByLabelText('Bulk board due date'), '2026-07-04');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', {
        dueAt: new Date('2026-07-04T00:00:00.000Z'),
      });
      expect(fakes.updateItem).toHaveBeenCalledWith('item-2', {
        dueAt: new Date('2026-07-04T00:00:00.000Z'),
      });
    });
  });
});
