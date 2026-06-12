import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addBoardItemAction,
  createBoardAction,
  deleteBoardAction,
  pinBoardAction,
  removeBoardItemAction,
  updateBoardItemAction,
} from '@/app/actions/boards';

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeBoards: {
    createBoard: vi.fn(),
    archiveBoard: vi.fn(),
    addBoardItem: vi.fn(),
    updateBoardItem: vi.fn(),
    removeBoardItem: vi.fn(),
    pinBoard: vi.fn(),
  },
}));

vi.mock('@/lib/action-scope', async () => {
  const { z } = await import('zod');
  return {
    resolveScope: fakes.fakeResolveScope,
    uuidSchema: z.uuid(),
  };
});
vi.mock('next/cache', () => ({ revalidatePath: fakes.fakeRevalidatePath }));

const BOARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENTITY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeResolveScope.mockResolvedValue({
    ok: true,
    scope: { boards: fakes.fakeBoards },
    userId: USER_ID,
  });
  fakes.fakeBoards.createBoard.mockResolvedValue({ id: BOARD_ID });
  fakes.fakeBoards.archiveBoard.mockResolvedValue(true);
  fakes.fakeBoards.addBoardItem.mockResolvedValue({
    id: ITEM_ID,
    boardId: BOARD_ID,
    entityId: ENTITY_ID,
  });
  fakes.fakeBoards.updateBoardItem.mockResolvedValue({
    id: ITEM_ID,
    boardId: BOARD_ID,
    entityId: ENTITY_ID,
  });
  fakes.fakeBoards.removeBoardItem.mockResolvedValue({
    id: ITEM_ID,
    boardId: BOARD_ID,
    entityId: ENTITY_ID,
  });
  fakes.fakeBoards.pinBoard.mockResolvedValue(true);
});

describe('createBoardAction', () => {
  it('rejects malformed template input before resolving scope', async () => {
    const result = await createBoardAction({ name: 'Bad board', templateKind: 'spreadsheet' });

    expect(result.error).toBeTruthy();
    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
  });

  it('creates a template board through the board scope', async () => {
    const result = await createBoardAction({ name: 'Pilot pipeline', templateKind: 'pipeline' });

    expect(result).toEqual({ ok: true, id: BOARD_ID });
    expect(fakes.fakeBoards.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Pilot pipeline',
        templateKind: 'pipeline',
        recommendedObjectTypes: ['company', 'deal', 'project'],
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
  });
});

describe('deleteBoardAction', () => {
  it('archives a board and revalidates board surfaces', async () => {
    await expect(deleteBoardAction({ id: BOARD_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeBoards.archiveBoard).toHaveBeenCalledWith(BOARD_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
  });
});

describe('addBoardItemAction', () => {
  it('adds an existing object to the board with a user actor', async () => {
    await expect(addBoardItemAction({ boardId: BOARD_ID, entityId: ENTITY_ID })).resolves.toEqual({
      ok: true,
      id: ITEM_ID,
    });

    expect(fakes.fakeBoards.addBoardItem).toHaveBeenCalledWith(BOARD_ID, {
      entityId: ENTITY_ID,
      laneId: null,
      actor: { kind: 'user', userId: USER_ID },
    });
  });
});

describe('updateBoardItemAction', () => {
  it('updates board-local fields through the board scope', async () => {
    await expect(updateBoardItemAction({ id: ITEM_ID, priority: 2 })).resolves.toEqual({
      ok: true,
      id: ITEM_ID,
    });

    expect(fakes.fakeBoards.updateBoardItem).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ priority: 2 }),
      { kind: 'user', userId: USER_ID },
    );
  });
});

describe('removeBoardItemAction', () => {
  it('removes a board item and revalidates the linked object page', async () => {
    await expect(removeBoardItemAction({ id: ITEM_ID, boardId: BOARD_ID })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeBoards.removeBoardItem).toHaveBeenCalledWith(ITEM_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${ENTITY_ID}`);
  });
});

describe('pinBoardAction', () => {
  it('pins a board for the current user', async () => {
    await expect(pinBoardAction({ id: BOARD_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeBoards.pinBoard).toHaveBeenCalledWith(BOARD_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app');
  });
});
