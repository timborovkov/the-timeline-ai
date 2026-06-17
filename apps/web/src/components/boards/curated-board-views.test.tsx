// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';

const fakes = vi.hoisted(() => ({
  updateItem: vi.fn(),
}));

const { CuratedBoardList, CuratedBoardTable } = await import('./curated-board-views.js');

function boardItem(input: Partial<boards.BoardItemRow['object']> = {}): boards.BoardItemRow {
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
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...input,
    },
  };
}

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
        lanes={[
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
        ]}
        items={[boardItem()]}
        members={[{ id: 'user-1', label: 'Ada' }]}
        onUpdateItem={fakes.updateItem}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText('Responsible person for Launch review'),
      'user-1',
    );
    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', {
        responsibleUserId: 'user-1',
      });
    });

    await user.selectOptions(screen.getByLabelText('Lane for Launch review'), 'lane-2');
    await waitFor(() => {
      expect(fakes.updateItem).toHaveBeenCalledWith('item-1', { laneId: 'lane-2' });
    });
  });

  it('uses the same date-only due timestamp as the detail panel', () => {
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

    fireEvent.change(screen.getByLabelText('Due date for Launch review'), {
      target: { value: '2026-07-04' },
    });

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

  it('syncs the next step editor when refreshed item props change', () => {
    const item = { ...boardItem(), nextStep: 'Call customer' };
    const { rerender } = render(
      <CuratedBoardTable boardId="board-1" view="table" lanes={[]} items={[item]} members={[]} />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Next step for Launch review').value).toBe(
      'Call customer',
    );

    rerender(
      <CuratedBoardTable
        boardId="board-1"
        view="table"
        lanes={[]}
        items={[{ ...item, nextStep: null }]}
        members={[]}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>('Next step for Launch review').value).toBe('');
  });
});

describe('CuratedBoardList', () => {
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
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
  });
});
