// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';

const fakes = vi.hoisted(() => ({
  addBoardItemAction: vi.fn(),
  quickCreateBoardItemAction: vi.fn(),
  searchAddableObjectsAction: vi.fn(),
}));

vi.mock('@/app/actions/boards', () => ({
  addBoardItemAction: fakes.addBoardItemAction,
  quickCreateBoardItemAction: fakes.quickCreateBoardItemAction,
}));
vi.mock('@/app/actions/objects', () => ({
  searchAddableObjectsAction: fakes.searchAddableObjectsAction,
}));
vi.mock('@/lib/notify', () => ({
  notifyAction: async ({ run }: { run: () => Promise<{ error?: string }> }) => {
    try {
      return await run();
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'failed' };
    }
  },
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
    agentSuggested: false,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('BoardAddItemForm', () => {
  beforeEach(() => {
    cleanup();
    fakes.addBoardItemAction.mockReset();
    fakes.quickCreateBoardItemAction.mockReset();
    fakes.searchAddableObjectsAction.mockReset();
    fakes.searchAddableObjectsAction.mockResolvedValue({ results: [] });
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
    expect(html).not.toContain('Expand add item');
    expect(html).not.toContain('Search existing objects');
    expect(html).not.toContain('MyAuditor');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Add to board');
  });

  it('hides UUID-shaped object names and aliases in the existing-object picker', async () => {
    const internalName = '018f22e2-7a9b-7cc3-98c4-3a2b1c0d9e8f';
    const internalAlias = '11111111-1111-4111-8111-111111111111';
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId={null}
        recommendedTypes={['company']}
        candidates={[
          objectRow({
            id: 'object-1',
            canonicalName: internalName,
            type: 'company',
            aliases: [internalAlias],
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(screen.getByRole('button', { name: /Untitled object/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain(internalName);
    expect(document.body.textContent).not.toContain(internalAlias);
  });

  it('unfolds existing-object search, selects an object, and adds it to the board', async () => {
    const addedObject = objectRow({
      id: 'object-1',
      canonicalName: 'MyAuditor',
      type: 'company',
      aliases: ['AuditAI'],
    });
    fakes.addBoardItemAction.mockResolvedValue({
      ok: true,
      id: 'item-1',
      item: {
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
        object: addedObject,
      },
    });
    const optimistic = vi.fn<(item: boards.BoardItemRow) => void>();
    const committed = vi.fn<(item: boards.BoardItemRow, optimisticId: string) => void>();
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId="lane-1"
        recommendedTypes={['company']}
        candidates={[
          addedObject,
          objectRow({ id: 'object-2', canonicalName: 'Subcontracting', type: 'topic' }),
        ]}
        onOptimisticItem={optimistic}
        onItemAdded={committed}
      />,
    );

    expect(screen.queryByRole('searchbox', { name: 'Search existing objects' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add item' }));
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
      const optimisticItem = optimistic.mock.calls[0]?.[0];
      const committedItem = committed.mock.calls[0]?.[0];
      const optimisticId = committed.mock.calls[0]?.[1];
      expect(optimisticItem?.boardId).toBe('board-1');
      expect(optimisticItem?.entityId).toBe('object-1');
      expect(optimisticItem?.laneId).toBe('lane-1');
      expect(optimisticItem?.object.canonicalName).toBe('MyAuditor');
      expect(committedItem?.id).toBe('item-1');
      expect(committedItem?.entityId).toBe('object-1');
      expect(optimisticId).toMatch(/^optimistic-/);
    });
    expect(fakes.quickCreateBoardItemAction).not.toHaveBeenCalled();
  });

  it('rolls back the optimistic item when the add action rejects', async () => {
    fakes.addBoardItemAction.mockRejectedValue(new Error('Network lost'));
    const optimistic = vi.fn<(item: boards.BoardItemRow) => void>();
    const rollback = vi.fn<(item: boards.BoardItemRow) => void>();
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
          }),
        ]}
        onOptimisticItem={optimistic}
        onItemAddFailed={rollback}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: /MyAuditor/ }));
    await user.click(screen.getByRole('button', { name: 'Add to board' }));

    await waitFor(() => {
      const optimisticItem = optimistic.mock.calls[0]?.[0];
      const rolledBackItem = rollback.mock.calls[0]?.[0];
      expect(optimisticItem?.id).toMatch(/^optimistic-/);
      expect(rolledBackItem?.id).toBe(optimisticItem?.id);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('exposes the selected add mode without relying on its color', async () => {
    const user = userEvent.setup();
    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId={null}
        recommendedTypes={['company']}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(screen.getByRole('group', { name: 'Add item mode' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'existing' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'new' }));
    expect(screen.getByRole('button', { name: 'new' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps person and company filters and loads those types from the server', async () => {
    const person = objectRow({
      id: 'person-1',
      canonicalName: 'Ada Buyer',
      type: 'person',
    });
    fakes.searchAddableObjectsAction.mockResolvedValue({ results: [person] });
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId={null}
        recommendedTypes={['company', 'deal', 'project']}
        candidates={[objectRow({ id: 'task-1', canonicalName: 'Write proposal', type: 'task' })]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));

    expect(screen.getByRole('button', { name: 'person' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'company' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Write proposal/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'person' }));

    await waitFor(() => {
      expect(fakes.searchAddableObjectsAction).toHaveBeenCalledWith({
        query: '',
        type: 'person',
      });
    });
    expect(screen.getByRole('button', { name: /Ada Buyer/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Write proposal/ })).toBeNull();
  });

  it('keeps a selected remote object addable after search results change', async () => {
    const person = objectRow({
      id: 'person-1',
      canonicalName: 'Ada Buyer',
      type: 'person',
    });
    fakes.searchAddableObjectsAction.mockResolvedValue({ results: [person] });
    fakes.addBoardItemAction.mockResolvedValue({
      ok: true,
      id: 'item-1',
      item: {
        id: 'item-1',
        boardId: 'board-1',
        entityId: 'person-1',
        laneId: null,
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
        object: person,
      },
    });
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId={null}
        recommendedTypes={['company', 'deal', 'project']}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'person' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ada Buyer/ })).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: /Ada Buyer/ }));
    expect(screen.getByRole('button', { name: 'Add to board' }).hasAttribute('disabled')).toBe(
      false,
    );

    fakes.searchAddableObjectsAction.mockResolvedValue({ results: [] });
    await user.type(screen.getByRole('searchbox', { name: 'Search existing objects' }), 'zzz');
    await waitFor(() => {
      expect(fakes.searchAddableObjectsAction).toHaveBeenCalledWith({
        query: 'zzz',
        type: 'person',
      });
    });
    expect(screen.getByText('Ada Buyer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to board' }).hasAttribute('disabled')).toBe(
      false,
    );

    await user.click(screen.getByRole('button', { name: 'Add to board' }));
    await waitFor(() => {
      expect(fakes.addBoardItemAction).toHaveBeenCalledWith({
        boardId: 'board-1',
        entityId: 'person-1',
        laneId: null,
      });
    });
  });

  it('shows a search failure instead of an empty match list', async () => {
    const person = objectRow({
      id: 'person-1',
      canonicalName: 'Ada Buyer',
      type: 'person',
    });
    fakes.searchAddableObjectsAction
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ results: [person] });
    const user = userEvent.setup();

    render(
      <BoardAddItemForm
        boardId="board-1"
        defaultLaneId={null}
        recommendedTypes={['company']}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add item' }));
    await user.click(screen.getByRole('button', { name: 'person' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn.t load existing objects/);
    });
    expect(screen.queryByText('No existing objects match this search.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ada Buyer/ })).toBeTruthy();
    });
  });
});
