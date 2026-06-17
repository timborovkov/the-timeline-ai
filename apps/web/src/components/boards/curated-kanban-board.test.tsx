// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ updateBoardItemAction: vi.fn() }));

const { CuratedKanbanBoard } = await import('./curated-kanban-board.js');

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
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };
}

describe('CuratedKanbanBoard', () => {
  beforeEach(() => {
    cleanup();
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
