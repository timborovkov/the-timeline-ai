// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ removeBoardItemAction: vi.fn() }));

const { BoardCardDetail } = await import('./board-card-detail.js');

function boardItem(input: {
  id: string;
  entityId: string;
  canonicalName: string;
  notes?: string | null;
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
    notes: input.notes ?? null,
    customFields: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    object: {
      id: input.entityId,
      canonicalName: input.canonicalName,
      type: 'company',
      aliases: [],
      status: 'open',
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
    },
  };
}

describe('BoardCardDetail', () => {
  beforeEach(() => {
    cleanup();
  });

  it('surfaces a remove-from-board action without implying object deletion', () => {
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
    });

    const html = renderToStaticMarkup(
      createElement(BoardCardDetail, {
        boardId: 'board-1',
        view: 'kanban',
        item,
        history: [],
      }),
    );

    expect(html).toContain('Remove from board');
    expect(html).toContain('Open object');
    expect(html).not.toContain('Delete object');
  });

  it('clears unsaved note draft when the selected board item changes', async () => {
    const user = userEvent.setup();
    const onUpdateItem = vi.fn(() => Promise.resolve({ ok: true }));
    const { rerender } = render(
      <BoardCardDetail
        key="item-1"
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
        })}
        history={[]}
        onUpdateItem={onUpdateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText('Board notes'), 'draft for alpha');

    rerender(
      <BoardCardDetail
        key="item-2"
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-2',
          entityId: 'object-2',
          canonicalName: 'Beta',
        })}
        history={[]}
        onUpdateItem={onUpdateItem}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
      expect(screen.queryByLabelText('Board notes')).toBeNull();
    });
    expect(onUpdateItem).not.toHaveBeenCalled();
  });
});
