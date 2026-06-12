import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ removeBoardItemAction: vi.fn() }));

const { BoardCardDetail } = await import('./board-card-detail.js');

describe('BoardCardDetail', () => {
  it('surfaces a remove-from-board action without implying object deletion', () => {
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
});
