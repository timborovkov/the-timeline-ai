import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addBoardItemAction,
  createBoardAction,
  deleteBoardAction,
  pinBoardAction,
  quickCreateBoardItemAction,
  renameBoardAction,
  removeBoardItemAction,
  updateBoardSettingsAction,
  updateBoardItemAction,
} from '@/app/actions/boards';

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeReportCaughtError: vi.fn(),
  fakeBoards: {
    createBoard: vi.fn(),
    archiveBoard: vi.fn(),
    addBoardItem: vi.fn(),
    createObjectAndAddBoardItem: vi.fn(),
    renameBoard: vi.fn(),
    updateBoardSettings: vi.fn(),
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
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.fakeReportCaughtError }));

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
    object: { id: ENTITY_ID },
  });
  fakes.fakeBoards.createObjectAndAddBoardItem.mockResolvedValue({
    id: ITEM_ID,
    boardId: BOARD_ID,
    entityId: ENTITY_ID,
    object: { id: ENTITY_ID },
  });
  fakes.fakeBoards.renameBoard.mockResolvedValue(true);
  fakes.fakeBoards.updateBoardSettings.mockResolvedValue(true);
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
        purpose: '',
        templateKind: 'pipeline',
        recommendedObjectTypes: ['company', 'deal', 'project'],
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
  });

  it('creates a board with user-defined stages', async () => {
    const result = await createBoardAction({
      name: 'Flexible work',
      templateKind: 'custom',
      lanes: [
        { name: 'Backlog', kind: 'active' },
        { name: 'Review', kind: 'active' },
        { name: 'Done', kind: 'done' },
      ],
    });

    expect(result).toEqual({ ok: true, id: BOARD_ID });
    expect(fakes.fakeBoards.createBoard).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Flexible work',
        templateKind: 'custom',
        lanes: [
          { name: 'Backlog', kind: 'active' },
          { name: 'Review', kind: 'active' },
          { name: 'Done', kind: 'done' },
        ],
      }),
    );
  });
});

describe('deleteBoardAction', () => {
  it('archives a board and revalidates board surfaces', async () => {
    await expect(deleteBoardAction({ id: BOARD_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeBoards.archiveBoard).toHaveBeenCalledWith(BOARD_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
  });
});

describe('renameBoardAction', () => {
  it('renames a board and refreshes board surfaces', async () => {
    await expect(renameBoardAction({ id: BOARD_ID, name: 'Renamed board' })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeBoards.renameBoard).toHaveBeenCalledWith({
      id: BOARD_ID,
      name: 'Renamed board',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
  });

  it('rejects empty board names before resolving scope', async () => {
    await expect(renameBoardAction({ id: BOARD_ID, name: '   ' })).resolves.toEqual({
      error: 'Too small: expected string to have >=1 characters',
    });

    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
  });
});

describe('updateBoardSettingsAction', () => {
  it('updates board settings and stages through the board scope', async () => {
    await expect(
      updateBoardSettingsAction({
        id: BOARD_ID,
        name: 'Flexible board',
        purpose: 'Team-defined workflow',
        lanes: [
          { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Review', kind: 'active' },
          { name: 'Done', kind: 'done' },
        ],
      }),
    ).resolves.toEqual({ ok: true });

    expect(fakes.fakeBoards.updateBoardSettings).toHaveBeenCalledWith({
      id: BOARD_ID,
      name: 'Flexible board',
      purpose: 'Team-defined workflow',
      lanes: [
        { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Review', kind: 'active' },
        { name: 'Done', kind: 'done' },
      ],
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
  });

  it('rejects settings without stages before resolving scope', async () => {
    await expect(
      updateBoardSettingsAction({
        id: BOARD_ID,
        name: 'Flexible board',
        purpose: '',
        lanes: [],
      }),
    ).resolves.toEqual({ error: 'Too small: expected array to have >=1 items' });

    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
  });
});

describe('addBoardItemAction', () => {
  it('adds an existing object to the board with a user actor', async () => {
    const result = await addBoardItemAction({ boardId: BOARD_ID, entityId: ENTITY_ID });

    expect(result.ok).toBe(true);
    expect(result.id).toBe(ITEM_ID);
    expect(result.item?.id).toBe(ITEM_ID);
    expect(result.item?.entityId).toBe(ENTITY_ID);

    expect(fakes.fakeBoards.addBoardItem).toHaveBeenCalledWith(BOARD_ID, {
      entityId: ENTITY_ID,
      laneId: null,
      actor: { kind: 'user', userId: USER_ID },
    });
  });

  it('keeps optimistic adds successful when board revalidation fails after persistence', async () => {
    const err = new Error('cache unavailable');
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw err;
    });

    const result = await addBoardItemAction({ boardId: BOARD_ID, entityId: ENTITY_ID });

    expect(result.ok).toBe(true);
    expect(result.item?.id).toBe(ITEM_ID);
    expect(fakes.fakeBoards.addBoardItem).toHaveBeenCalled();
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'revalidate_board_surfaces',
    });
  });
});

describe('quickCreateBoardItemAction', () => {
  it('keeps optimistic quick creates successful when board revalidation fails after persistence', async () => {
    const err = new Error('cache unavailable');
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw err;
    });

    const result = await quickCreateBoardItemAction({
      boardId: BOARD_ID,
      type: 'company',
      canonicalName: 'Acme',
    });

    expect(result.ok).toBe(true);
    expect(result.item?.id).toBe(ITEM_ID);
    expect(fakes.fakeBoards.createObjectAndAddBoardItem).toHaveBeenCalledWith(
      BOARD_ID,
      { type: 'company', canonicalName: 'Acme' },
      { laneId: null, actor: { kind: 'user', userId: USER_ID } },
    );
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
