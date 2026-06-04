import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  createNoteAction,
  createObjectAction,
  deleteNoteAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  rejectObjectChangeAction,
  removeRelationshipAction,
  updateNoteAction,
  updateObjectAction,
} from '@/app/actions/objects';

/**
 * Server-action tests for object actions. The shared object scope owns the
 * real database behavior; these tests pin the action boundary: validation,
 * auth/scope failure, friendly errors, action-to-scope payloads, and
 * revalidation paths the UI depends on after mutations.
 */

const fakes = vi.hoisted(() => ({
  fakeResolveScope: vi.fn(),
  fakeRevalidatePath: vi.fn(),
  fakeReportCaughtError: vi.fn(),
  fakeObjects: {
    createObject: vi.fn(),
    updateObject: vi.fn(),
    archiveObject: vi.fn(),
    addRelationship: vi.fn(),
    removeRelationship: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    acceptObjectChange: vi.fn(),
    rejectObjectChange: vi.fn(),
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

const USER_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_OBJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHANGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeResolveScope.mockResolvedValue({
    ok: true,
    scope: { objects: fakes.fakeObjects },
    userId: USER_ID,
  });
  fakes.fakeObjects.createObject.mockResolvedValue({ id: OBJECT_ID });
  fakes.fakeObjects.updateObject.mockResolvedValue(undefined);
  fakes.fakeObjects.archiveObject.mockResolvedValue(undefined);
  fakes.fakeObjects.addRelationship.mockResolvedValue(undefined);
  fakes.fakeObjects.removeRelationship.mockResolvedValue(undefined);
  fakes.fakeObjects.createNote.mockResolvedValue({ id: NOTE_ID });
  fakes.fakeObjects.updateNote.mockResolvedValue(true);
  fakes.fakeObjects.deleteNote.mockResolvedValue(true);
  fakes.fakeObjects.markNotificationRead.mockResolvedValue(true);
  fakes.fakeObjects.markAllNotificationsRead.mockResolvedValue(undefined);
  fakes.fakeObjects.acceptObjectChange.mockResolvedValue(true);
  fakes.fakeObjects.rejectObjectChange.mockResolvedValue(true);
});

describe('object action validation and scope', () => {
  it('rejects malformed create input before resolving scope', async () => {
    const result = await createObjectAction({ type: 'task', canonicalName: '   ' });

    expect(result.error).toBeTruthy();
    expect(fakes.fakeResolveScope).not.toHaveBeenCalled();
    expect(fakes.fakeObjects.createObject).not.toHaveBeenCalled();
  });

  it('returns scope errors without touching object scope', async () => {
    fakes.fakeResolveScope.mockResolvedValue({ ok: false, error: 'No active team' });

    await expect(createObjectAction({ type: 'task', canonicalName: 'Follow up' })).resolves.toEqual(
      {
        error: 'No active team',
      },
    );
    expect(fakes.fakeObjects.createObject).not.toHaveBeenCalled();
  });
});

describe('object CRUD actions', () => {
  it('creates an object with normalized optional fields and revalidates the index', async () => {
    const result = await createObjectAction({
      type: 'task',
      canonicalName: 'Follow up',
      dueAt: '2026-06-03T10:00:00.000Z',
    });

    expect(result).toEqual({ ok: true, id: OBJECT_ID });
    expect(fakes.fakeObjects.createObject).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task',
        canonicalName: 'Follow up',
        ownerUserId: null,
        assigneeUserId: null,
        dueAt: new Date('2026-06-03T10:00:00.000Z'),
        parentObjectId: null,
        actor: { kind: 'user', userId: USER_ID },
      }),
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
  });

  it('maps duplicate-key errors to a friendly create error', async () => {
    fakes.fakeObjects.createObject.mockRejectedValue({ code: '23505' });

    await expect(createObjectAction({ type: 'task', canonicalName: 'Follow up' })).resolves.toEqual(
      {
        error: 'An object with that name already exists.',
      },
    );
    expect(fakes.fakeReportCaughtError).not.toHaveBeenCalled();
  });

  it('reports unmapped object failures before returning the action error', async () => {
    const err = new Error('database down');
    fakes.fakeObjects.createObject.mockRejectedValue(err);

    await expect(createObjectAction({ type: 'task', canonicalName: 'Follow up' })).resolves.toEqual(
      {
        error: 'database down',
      },
    );
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'failed_to_create_object',
    });
  });

  it('updates object fields and revalidates object, board, and task surfaces', async () => {
    const result = await updateObjectAction({
      id: OBJECT_ID,
      status: 'doing',
      dueAt: null,
    });

    expect(result).toEqual({ ok: true, id: OBJECT_ID });
    expect(fakes.fakeObjects.updateObject).toHaveBeenCalledWith(
      OBJECT_ID,
      { status: 'doing', dueAt: null },
      { kind: 'user', userId: USER_ID },
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/tasks');
  });

  it('archives an object and refreshes surfaces that hide archived rows', async () => {
    await expect(archiveObjectAction({ id: OBJECT_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeObjects.archiveObject).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
  });
});

describe('object relationship, note, notification, and suggestion actions', () => {
  it('adds and removes relationships with both object pages revalidated', async () => {
    await expect(
      addRelationshipAction({
        fromEntityId: OBJECT_ID,
        toEntityId: OTHER_OBJECT_ID,
        kind: 'related',
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeObjects.addRelationship).toHaveBeenCalledWith({
      fromEntityId: OBJECT_ID,
      toEntityId: OTHER_OBJECT_ID,
      kind: 'related',
      actorUserId: USER_ID,
    });

    await expect(
      removeRelationshipAction({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        entityId: OBJECT_ID,
        otherEntityId: OTHER_OBJECT_ID,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OTHER_OBJECT_ID}`);
  });

  it('creates, updates, and deletes notes through author-aware scope methods', async () => {
    await expect(createNoteAction({ entityId: OBJECT_ID, body: 'Note' })).resolves.toEqual({
      ok: true,
      id: NOTE_ID,
    });
    expect(fakes.fakeObjects.createNote).toHaveBeenCalledWith({
      entityId: OBJECT_ID,
      body: 'Note',
      authorUserId: USER_ID,
    });

    await expect(
      updateNoteAction({ noteId: NOTE_ID, entityId: OBJECT_ID, body: 'Updated' }),
    ).resolves.toEqual({ ok: true });
    await expect(deleteNoteAction({ noteId: NOTE_ID, entityId: OBJECT_ID })).resolves.toEqual({
      ok: true,
    });
  });

  it('surfaces not-found note updates as action errors', async () => {
    fakes.fakeObjects.updateNote.mockResolvedValue(false);

    await expect(
      updateNoteAction({ noteId: NOTE_ID, entityId: OBJECT_ID, body: 'Updated' }),
    ).resolves.toEqual({ error: 'Note not found' });
  });

  it('marks notifications read and accepts/rejects suggestions with inbox revalidation', async () => {
    await expect(markNotificationReadAction(CHANGE_ID)).resolves.toEqual({ ok: true });
    await expect(markAllNotificationsReadAction()).resolves.toEqual({ ok: true });
    await expect(
      acceptObjectChangeAction({ changeId: CHANGE_ID, entityId: OBJECT_ID }),
    ).resolves.toEqual({
      ok: true,
    });
    await expect(
      rejectObjectChangeAction({ changeId: CHANGE_ID, entityId: OBJECT_ID }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeObjects.markNotificationRead).toHaveBeenCalledWith(CHANGE_ID);
    expect(fakes.fakeObjects.acceptObjectChange).toHaveBeenCalledWith(CHANGE_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.rejectObjectChange).toHaveBeenCalledWith(CHANGE_ID);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/inbox');
  });
});
