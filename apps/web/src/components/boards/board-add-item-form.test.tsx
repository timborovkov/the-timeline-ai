// @vitest-environment happy-dom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as objects from '@timeline/shared/objects';

const fakes = vi.hoisted(() => ({
  addBoardItemAction: vi.fn(),
  quickCreateBoardItemAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fakes.refresh }) }));
vi.mock('@/app/actions/boards', () => ({
  addBoardItemAction: fakes.addBoardItemAction,
  quickCreateBoardItemAction: fakes.quickCreateBoardItemAction,
}));

const { BoardAddItemForm } = await import('./board-add-item-form.js');

function objectRow(input: {
  id: string;
  canonicalName: string;
  type: objects.ObjectType;
  aliases?: string[];
}): objects.ObjectRow {
  return {
    id: input.id,
    canonicalName: input.canonicalName,
    type: input.type,
    aliases: input.aliases ?? [],
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as objects.ObjectRow;
}

describe('BoardAddItemForm', () => {
  beforeEach(() => {
    fakes.addBoardItemAction.mockReset();
    fakes.quickCreateBoardItemAction.mockReset();
    fakes.refresh.mockReset();
  });

  it('renders add item as a collapsed panel toggle by default', () => {
    const html = renderToStaticMarkup(
      createElement(BoardAddItemForm, {
        boardId: 'board-1',
        defaultLaneId: null,
        recommendedTypes: ['company'],
        candidates: [
          objectRow({
            id: 'object-1',
            canonicalName: 'MyAuditor',
            type: 'company',
            aliases: ['AuditAI'],
          }),
          objectRow({ id: 'object-2', canonicalName: 'Subcontracting', type: 'topic' }),
        ],
      }),
    );

    expect(html).toContain('Add item');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Expand add item');
    expect(html).not.toContain('Search existing objects');
    expect(html).not.toContain('MyAuditor');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Add to board');
  });

  it('unfolds existing-object search, selects an object, and adds it to the board', async () => {
    fakes.addBoardItemAction.mockResolvedValue({ ok: true, id: 'item-1' });
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId="lane-1"
        recommendedTypes={['company']}
        candidates={[
          objectRow({
            id: 'object-1',
            canonicalName: 'MyAuditor',
            type: 'company',
            aliases: ['AuditAI'],
          }),
          objectRow({ id: 'object-2', canonicalName: 'Subcontracting', type: 'topic' }),
        ]}
      />,
    );

    expect(screen.queryByRole('searchbox', { name: 'Search existing objects' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand add item' }));
    const search = screen.getByRole('searchbox', { name: 'Search existing objects' });
    expect(search).toBeTruthy();
    expect(screen.getByRole('button', { name: /MyAuditor/ })).toBeTruthy();

    await user.type(search, 'audit');
    expect(screen.getByText('MyAuditor')).toBeTruthy();
    expect(screen.queryByText('Subcontracting')).toBeNull();

    const submit = screen.getByRole('button', { name: 'Add to board' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: /MyAuditor/ }));
    expect(submit.hasAttribute('disabled')).toBe(false);

    await user.click(submit);

    await waitFor(() => {
      expect(fakes.addBoardItemAction).toHaveBeenCalledWith({
        boardId: 'board-1',
        entityId: 'object-1',
        laneId: 'lane-1',
      });
    });
    await waitFor(() => {
      expect(fakes.refresh).toHaveBeenCalled();
    });
    expect(fakes.quickCreateBoardItemAction).not.toHaveBeenCalled();
  });
});
