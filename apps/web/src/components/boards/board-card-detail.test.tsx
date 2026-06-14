import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ removeBoardItemAction: vi.fn() }));

const { BoardCardDetail } = await import('./board-card-detail.js');

describe('BoardCardDetail', () => {
  const item = {
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
      canonicalName: 'MyAuditor',
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
  } as boards.BoardItemRow;

  it('surfaces a remove-from-board action without implying object deletion', () => {
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

  it('links source evidence to the focused timeline event', () => {
    const sourceEventId = '11111111-1111-4111-8111-111111111111';
    const history: boards.BoardItemChangeRow[] = [
      {
        id: 'change-1',
        boardId: 'board-1',
        boardItemId: item.id,
        entityId: item.entityId,
        field: 'laneId',
        previousValue: null,
        newValue: 'lane-1',
        note: null,
        sourceEventId,
        suggestionItemId: null,
        actorUserId: null,
        actorKind: 'agent',
        status: 'applied',
        changedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ];
    const html = renderToStaticMarkup(
      createElement(BoardCardDetail, {
        boardId: 'board-1',
        view: 'kanban',
        item,
        history,
      }),
    );

    expect(html).toContain(`/app/timeline?event=${sourceEventId}#ev-${sourceEventId}`);
  });
});
