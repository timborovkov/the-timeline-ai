import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteBoardAction, saveBoardAction } from '@/app/actions/boards';

/**
 * Server-action tests for saved board views. The object scope owns persistence;
 * these tests pin action-level validation, scope failure, payload forwarding,
 * not-found handling, and revalidation.
 */

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeObjects: {
    saveBoardView: vi.fn(),
    deleteBoardView: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeResolveScope.mockResolvedValue({
    ok: true,
    scope: { objects: fakes.fakeObjects },
    userId: '22222222-2222-4222-8222-222222222222',
  });
  fakes.fakeObjects.saveBoardView.mockResolvedValue({ id: BOARD_ID });
  fakes.fakeObjects.deleteBoardView.mockResolvedValue(true);
});

describe('saveBoardAction', () => {
  it('rejects malformed filters before resolving scope', async () => {
    const result = await saveBoardAction({
      name: 'Bad board',
      kind: 'kanban',
      filter: { limit: 9999 },
    });

    expect(result.error).toBeTruthy();
    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
    expect(fakes.fakeObjects.saveBoardView).not.toHaveBeenCalled();
  });

  it('returns scope errors without saving', async () => {
    fakes.fakeResolveScope.mockResolvedValue({ ok: false, error: 'Not signed in' });

    await expect(
      saveBoardAction({ name: 'Tasks', kind: 'list', filter: { archived: false } }),
    ).resolves.toEqual({ error: 'Not signed in' });
    expect(fakes.fakeObjects.saveBoardView).not.toHaveBeenCalled();
  });

  it('creates a board and revalidates the board index', async () => {
    const result = await saveBoardAction({
      name: 'Tasks',
      kind: 'kanban',
      filter: { type: 'task', archived: false, limit: 100 },
      groupBy: 'status',
      isShared: true,
    });

    expect(result).toEqual({ ok: true, id: BOARD_ID });
    expect(fakes.fakeObjects.saveBoardView).toHaveBeenCalledWith({
      id: undefined,
      name: 'Tasks',
      kind: 'kanban',
      filter: { type: 'task', archived: false, limit: 100 },
      groupBy: 'status',
      isShared: true,
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
  });

  it('updates a board and revalidates both index and detail', async () => {
    const result = await saveBoardAction({
      id: BOARD_ID,
      name: 'Tasks v2',
      kind: 'table',
      filter: { archived: false },
      groupBy: null,
    });

    expect(result).toEqual({ ok: true, id: BOARD_ID });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/boards/${BOARD_ID}`);
  });
});

describe('deleteBoardAction', () => {
  it('rejects invalid ids before resolving scope', async () => {
    await expect(deleteBoardAction({ id: 'not-a-uuid' })).resolves.toEqual({
      error: 'Invalid id',
    });
    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
  });

  it('returns not-found when the scope does not delete a row', async () => {
    fakes.fakeObjects.deleteBoardView.mockResolvedValue(false);

    await expect(deleteBoardAction({ id: BOARD_ID })).resolves.toEqual({
      error: 'Board not found',
    });
  });

  it('deletes a board and revalidates the index', async () => {
    await expect(deleteBoardAction({ id: BOARD_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeObjects.deleteBoardView).toHaveBeenCalledWith(BOARD_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards');
  });
});
