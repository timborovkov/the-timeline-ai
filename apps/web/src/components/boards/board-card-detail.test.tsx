// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions/boards', () => ({ removeBoardItemAction: vi.fn() }));

const { BoardCardDetail } = await import('./board-card-detail.js');

function boardItem(input: {
  id: string;
  entityId: string;
  canonicalName: string;
  laneId?: string | null;
  responsibleUserId?: string | null;
  dueAt?: Date | null;
  priority?: number | null;
  nextStep?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}): boards.BoardItemRow {
  return {
    id: input.id,
    boardId: 'board-1',
    entityId: input.entityId,
    laneId: input.laneId ?? 'lane-1',
    position: 0,
    responsibleUserId: input.responsibleUserId ?? null,
    dueAt: input.dueAt ?? null,
    priority: input.priority ?? null,
    nextStep: input.nextStep ?? null,
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
      metadata: input.metadata ?? {},
      agentSuggested: false,
      archivedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };
}

const lanes: boards.BoardLaneRow[] = [
  {
    id: 'lane-1',
    boardId: 'board-1',
    name: 'Doing',
    position: 0,
    kind: 'active',
    archivedAt: null,
  },
  {
    id: 'lane-blocked',
    boardId: 'board-1',
    name: 'Blocked',
    position: 1,
    kind: 'blocked',
    archivedAt: null,
  },
];

function connectedWork(): objects.ObjectDetail['connectedWork'] {
  return {
    openTasks: [],
    recentTasks: [],
    calendarEvents: [],
    timelineEvents: [
      {
        id: 'event-1',
        source: 'slack',
        contentText: 'Discussed pilot materials',
        occurredAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    objects: [],
    boards: [],
    pendingApprovals: [],
    documents: [
      {
        id: 'document-1',
        name: 'DFK pilot deck.pdf',
        fileKind: 'document',
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    links: [
      {
        id: 'link-1',
        canonicalName: 'example.com/dfk',
        canonicalUrl: 'https://example.com/dfk',
        displayUrl: 'example.com/dfk',
        domain: 'example.com',
        provider: null,
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
    capturedFiles: [
      {
        id: 'file-1',
        name: 'whiteboard.png',
        contentType: 'image/png',
        sourceRawEventId: 'event-1',
        updatedAt: new Date('2026-06-16T10:00:00.000Z'),
      },
    ],
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
        lanes,
      }),
    );

    expect(html).toContain('Remove from board');
    expect(html).toContain('Open object');
    expect(html).not.toContain('Delete object');
  });

  it('wraps long board item titles in the detail panel', () => {
    const longTitle =
      'timborovkov/the-timeline-ai#202: Add cursor pagination to the visible board so the full sales opportunity title can be read';
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: longTitle,
    });

    render(
      <BoardCardDetail boardId="board-1" view="kanban" item={item} history={[]} lanes={lanes} />,
    );

    const heading = screen.getByRole('heading', { name: longTitle });
    expect(heading.className).toContain('break-words');
    expect(heading.className).not.toContain('truncate');
  });

  it('uses source-tracked integration display titles in the detail panel', () => {
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
      metadata: {
        display_title: 'the-timeline-ai: Add cursor pagination',
        display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
      },
    });

    render(
      <BoardCardDetail boardId="board-1" view="kanban" item={item} history={[]} lanes={lanes} />,
    );

    expect(
      screen.getByRole('heading', { name: 'the-timeline-ai: Add cursor pagination' }),
    ).toBeTruthy();
    expect(screen.queryByText(/timborovkov\/the-timeline-ai#202/)).toBeNull();
  });

  it('surfaces selected object related context in the board card panel', () => {
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
    });

    render(
      <BoardCardDetail
        boardId="board-1"
        view="kanban"
        item={item}
        connectedWork={connectedWork()}
        history={[]}
        lanes={lanes}
      />,
    );

    expect(screen.getByText('Related context')).toBeTruthy();
    expect(screen.getByRole('link', { name: /example.com\/dfk/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'DFK pilot deck.pdf' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /whiteboard.png/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Discussed pilot materials/ })).toBeTruthy();
  });

  it('does not link legacy source events without hydrated evidence', () => {
    const sourceEventId = '11111111-1111-4111-8111-111111111111';
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
    });
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
        evidence: [],
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
        lanes,
      }),
    );

    expect(html).not.toContain(`/app/timeline?event=${sourceEventId}#ev-${sourceEventId}`);
    expect(html).not.toContain('Source event');
    expect(html).toContain('No source evidence linked to board changes yet.');
    expect(html).toContain('Lane');
    expect(html).toContain('Doing');
  });

  it('shows board-local provenance from accepted suggestion evidence', () => {
    const sourceEventId = '22222222-2222-4222-8222-222222222222';
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
    });
    const history: boards.BoardItemChangeRow[] = [
      {
        id: 'change-1',
        boardId: 'board-1',
        boardItemId: item.id,
        entityId: item.entityId,
        field: '__add__',
        previousValue: null,
        newValue: { boardId: 'board-1', laneId: 'lane-1' },
        note: 'Added because the Telegram message asked us to track this on the custom board.',
        sourceEventId: null,
        suggestionItemId: 'suggestion-item-1',
        evidence: [
          {
            rawEventId: sourceEventId,
            source: 'telegram',
            contentText: 'Add MyAuditor to this board and use the screenshots as context.',
            quote: 'Add MyAuditor to this board',
            occurredAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
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
        lanes,
      }),
    );

    expect(html).toContain('Board provenance');
    expect(html).toContain('Added');
    expect(html).toContain('telegram');
    expect(html).toContain(`/app/timeline?event=${sourceEventId}#ev-${sourceEventId}`);
    expect(html).toContain('Added because the Telegram message asked us to track this');
  });

  it('does not present suggested changes as established board provenance', () => {
    const sourceEventId = '22222222-2222-4222-8222-222222222222';
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
    });
    const history: boards.BoardItemChangeRow[] = [
      {
        id: 'change-1',
        boardId: 'board-1',
        boardItemId: item.id,
        entityId: item.entityId,
        field: 'laneId',
        previousValue: 'lane-1',
        newValue: 'lane-blocked',
        note: 'A pending proposal should stay in activity until accepted.',
        sourceEventId,
        suggestionItemId: 'suggestion-item-1',
        evidence: [
          {
            rawEventId: sourceEventId,
            source: 'telegram',
            contentText: 'Maybe block MyAuditor.',
            quote: 'Maybe block MyAuditor',
            occurredAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
        actorUserId: null,
        actorKind: 'agent',
        status: 'suggested',
        changedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ];

    const html = renderToStaticMarkup(
      createElement(BoardCardDetail, {
        boardId: 'board-1',
        view: 'kanban',
        item,
        history,
        lanes,
      }),
    );

    expect(html).toContain('No source evidence linked to board changes yet.');
    expect(html).toContain('A pending proposal should stay in activity until accepted.');
    expect(html).not.toContain('Maybe block MyAuditor.');
  });

  it('formats remove provenance using the lane the item left', () => {
    const sourceEventId = '33333333-3333-4333-8333-333333333333';
    const item = boardItem({
      id: 'item-1',
      entityId: 'object-1',
      canonicalName: 'MyAuditor',
      laneId: null,
    });
    const history: boards.BoardItemChangeRow[] = [
      {
        id: 'change-1',
        boardId: 'board-1',
        boardItemId: item.id,
        entityId: item.entityId,
        field: '__remove__',
        previousValue: { boardId: 'board-1', laneId: 'lane-blocked' },
        newValue: null,
        note: null,
        sourceEventId,
        suggestionItemId: null,
        evidence: [],
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
        lanes,
      }),
    );

    expect(html).toContain('Blocked');
  });

  it('edits command-center fields through board item patches', async () => {
    const user = userEvent.setup();
    const onUpdateItem = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <BoardCardDetail
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
        })}
        history={[]}
        lanes={lanes}
        members={[{ id: 'user-1', label: 'Mikael' }]}
        onUpdateItem={onUpdateItem}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Lane'), 'lane-blocked');
    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith('item-1', { laneId: 'lane-blocked' });
    });
    await user.selectOptions(screen.getByLabelText('Responsible'), 'user-1');
    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith('item-1', { responsibleUserId: 'user-1' });
    });
    await user.type(screen.getByLabelText('Due'), '2026-07-05');
    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith('item-1', {
        dueAt: new Date('2026-07-05T00:00:00.000Z'),
      });
    });
    const priority = screen.getByLabelText('Priority');
    await waitFor(() => {
      expect(priority.hasAttribute('disabled')).toBe(false);
    });
    await user.selectOptions(priority, '2');
    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith('item-1', { priority: 2 });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Next step').hasAttribute('disabled')).toBe(false);
    });
    await user.type(screen.getByLabelText('Next step'), 'Call the buyer');
    await user.tab();

    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith('item-1', { nextStep: 'Call the buyer' });
    });
  });

  it('surfaces blocked lane state in the panel', () => {
    const html = renderToStaticMarkup(
      createElement(BoardCardDetail, {
        boardId: 'board-1',
        view: 'kanban',
        item: boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Blocked deal',
          laneId: 'lane-blocked',
        }),
        history: [],
        lanes,
      }),
    );

    expect(html).toContain('Blocked · Blocked');
    expect(html).toContain('Board lane');
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
        lanes={lanes}
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
        lanes={lanes}
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

  it('syncs a clean next-step draft when the selected item refreshes', async () => {
    const user = userEvent.setup();
    const onUpdateItem = vi.fn(() => Promise.resolve({ ok: true }));
    const { rerender } = render(
      <BoardCardDetail
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
          nextStep: 'Old server step',
        })}
        history={[]}
        lanes={lanes}
        onUpdateItem={onUpdateItem}
      />,
    );

    expect(screen.getByDisplayValue('Old server step')).toBeTruthy();

    rerender(
      <BoardCardDetail
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
          nextStep: 'Fresh server step',
        })}
        history={[]}
        lanes={lanes}
        onUpdateItem={onUpdateItem}
      />,
    );

    await user.click(screen.getByDisplayValue('Fresh server step'));
    await user.tab();

    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it('keeps the note editor open when saving notes fails', async () => {
    const user = userEvent.setup();
    const onUpdateItem = vi.fn(() => Promise.resolve({ error: 'Save failed' }));
    render(
      <BoardCardDetail
        boardId="board-1"
        view="kanban"
        item={boardItem({
          id: 'item-1',
          entityId: 'object-1',
          canonicalName: 'Alpha',
          notes: 'Original notes',
        })}
        history={[]}
        lanes={lanes}
        onUpdateItem={onUpdateItem}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText('Board notes');
    await user.clear(textarea);
    await user.type(textarea, 'Draft that should survive');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Board notes')).toBeTruthy();
      expect(screen.getByDisplayValue('Draft that should survive')).toBeTruthy();
    });
  });
});
