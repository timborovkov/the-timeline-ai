import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  bulkArchiveObjectsAction,
  createNoteAction,
  createObjectAction,
  deleteNoteAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  mergeObjectsAction,
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
  fakeTransaction: vi.fn(),
  fakeTx: { kind: 'tx' },
  fakeWithTeam: vi.fn(),
  fakeObjects: {
    createObject: vi.fn(),
    updateObject: vi.fn(),
    archiveObject: vi.fn(),
    mergeObjects: vi.fn(),
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
  fakeSuggestions: {
    acceptObjectMergeSuggestionItem: vi.fn(),
    reconcileCanonicalChange: vi.fn(),
    reconcileObjectMerge: vi.fn(),
  },
  fakeTransactionObjects: {
    archiveObject: vi.fn(),
  },
  fakeEnqueueSuggestionJob: vi.fn(),
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
vi.mock('@/lib/db', () => ({ db: { transaction: fakes.fakeTransaction } }));
vi.mock('@timeline/shared/team-scope', () => ({ withTeam: fakes.fakeWithTeam }));
vi.mock('@timeline/shared/queue', () => ({
  enqueueSuggestionJob: fakes.fakeEnqueueSuggestionJob,
}));

const USER_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_OBJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHANGE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function expectCanonicalReconciliation(input: Record<string, unknown>): void {
  expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledWith(input);
}

function expectApprovalsRevalidated(): void {
  expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.fakeTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(fakes.fakeTx),
  );
  fakes.fakeWithTeam.mockReturnValue({
    objects: fakes.fakeTransactionObjects,
  });
  fakes.fakeResolveScope.mockResolvedValue({
    ok: true,
    scope: { objects: fakes.fakeObjects, suggestions: fakes.fakeSuggestions },
    userId: USER_ID,
    teamId: '11111111-1111-4111-8111-111111111111',
  });
  fakes.fakeObjects.createObject.mockResolvedValue({ id: OBJECT_ID });
  fakes.fakeObjects.updateObject.mockResolvedValue({
    object: { id: OBJECT_ID, type: 'task' },
    changedFields: ['status', 'dueAt'],
  });
  fakes.fakeObjects.archiveObject.mockResolvedValue({
    id: OBJECT_ID,
    type: 'task',
    changedFields: ['archivedAt'],
  });
  fakes.fakeObjects.mergeObjects.mockResolvedValue({
    survivor: { id: OBJECT_ID },
    mergedIds: [OTHER_OBJECT_ID],
  });
  fakes.fakeObjects.addRelationship.mockResolvedValue({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  });
  fakes.fakeObjects.removeRelationship.mockResolvedValue(undefined);
  fakes.fakeObjects.createNote.mockResolvedValue({ id: NOTE_ID });
  fakes.fakeObjects.updateNote.mockResolvedValue(true);
  fakes.fakeObjects.deleteNote.mockResolvedValue(true);
  fakes.fakeObjects.markNotificationRead.mockResolvedValue(true);
  fakes.fakeObjects.markAllNotificationsRead.mockResolvedValue(undefined);
  fakes.fakeObjects.acceptObjectChange.mockResolvedValue(true);
  fakes.fakeObjects.rejectObjectChange.mockResolvedValue(true);
  fakes.fakeSuggestions.acceptObjectMergeSuggestionItem.mockResolvedValue({
    survivorId: OBJECT_ID,
  });
  fakes.fakeSuggestions.reconcileCanonicalChange.mockResolvedValue(1);
  fakes.fakeSuggestions.reconcileObjectMerge.mockResolvedValue(1);
  fakes.fakeTransactionObjects.archiveObject.mockImplementation((id: string) =>
    Promise.resolve({
      id,
      type: id === OBJECT_ID ? 'task' : 'person',
      changedFields: ['archivedAt'],
    }),
  );
  fakes.fakeEnqueueSuggestionJob.mockResolvedValue({ enqueued: true, jobId: 'cleanup-job' });
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
    expectCanonicalReconciliation({
      targetKind: 'task',
      targetId: OBJECT_ID,
      operation: 'update',
      patch: { status: true, dueAt: true },
      reason: 'A teammate updated this object directly.',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/tasks');
    expectApprovalsRevalidated();
  });

  it('returns success when post-update reconciliation fails after the object was saved', async () => {
    const err = new Error('reconcile down');
    fakes.fakeSuggestions.reconcileCanonicalChange.mockRejectedValueOnce(err);

    await expect(updateObjectAction({ id: OBJECT_ID, status: 'doing' })).resolves.toEqual({
      ok: true,
      id: OBJECT_ID,
    });

    expect(fakes.fakeObjects.updateObject).toHaveBeenCalled();
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'reconcile_object_update_after_update',
    });
    expectApprovalsRevalidated();
  });

  it('archives an object and refreshes surfaces that hide archived rows', async () => {
    await expect(archiveObjectAction({ id: OBJECT_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeObjects.archiveObject).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expectCanonicalReconciliation({
      targetKind: 'task',
      targetId: OBJECT_ID,
      operation: 'archive_or_cancel',
      reason: 'A teammate archived this object directly.',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
    expectApprovalsRevalidated();
  });

  it('returns success when post-archive reconciliation fails after the object was archived', async () => {
    const err = new Error('reconcile down');
    fakes.fakeSuggestions.reconcileCanonicalChange.mockRejectedValueOnce(err);

    await expect(archiveObjectAction({ id: OBJECT_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeObjects.archiveObject).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'reconcile_object_archive_after_archive',
    });
    expectApprovalsRevalidated();
  });

  it('does not supersede approvals when archiving is a no-op', async () => {
    fakes.fakeObjects.archiveObject.mockResolvedValueOnce({
      id: OBJECT_ID,
      type: 'task',
      changedFields: [],
    });

    await expect(archiveObjectAction({ id: OBJECT_ID })).resolves.toEqual({ ok: true });

    expect(fakes.fakeSuggestions.reconcileCanonicalChange).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
    expectApprovalsRevalidated();
  });

  it('bulk archives selected objects and refreshes cleanup surfaces', async () => {
    await expect(bulkArchiveObjectsAction({ ids: [OBJECT_ID, OTHER_OBJECT_ID] })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeTransaction).toHaveBeenCalledTimes(1);
    expect(fakes.fakeWithTeam).toHaveBeenCalledWith(
      fakes.fakeTx,
      '11111111-1111-4111-8111-111111111111',
      USER_ID,
    );
    expect(fakes.fakeTransactionObjects.archiveObject).toHaveBeenCalledTimes(2);
    expect(fakes.fakeTransactionObjects.archiveObject).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledTimes(2);
    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenNthCalledWith(1, {
      targetKind: 'task',
      targetId: OBJECT_ID,
      operation: 'archive_or_cancel',
      reason: 'A teammate archived this object directly.',
    });
    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenNthCalledWith(2, {
      targetKind: 'object',
      targetId: OTHER_OBJECT_ID,
      operation: 'archive_or_cancel',
      reason: 'A teammate archived this object directly.',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/tasks');
    expectApprovalsRevalidated();
  });

  it('returns success when one bulk post-archive reconciliation fails after archive commits', async () => {
    const err = new Error('reconcile down');
    fakes.fakeSuggestions.reconcileCanonicalChange.mockRejectedValueOnce(err);

    await expect(bulkArchiveObjectsAction({ ids: [OBJECT_ID, OTHER_OBJECT_ID] })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeTransactionObjects.archiveObject).toHaveBeenCalledTimes(2);
    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledTimes(2);
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'reconcile_object_archive_after_bulk_archive',
    });
    expectApprovalsRevalidated();
  });

  it('skips reconciliation for already-archived objects in bulk archive', async () => {
    fakes.fakeTransactionObjects.archiveObject.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        type: id === OBJECT_ID ? 'task' : 'person',
        changedFields: id === OBJECT_ID ? [] : ['archivedAt'],
      }),
    );

    await expect(bulkArchiveObjectsAction({ ids: [OBJECT_ID, OTHER_OBJECT_ID] })).resolves.toEqual({
      ok: true,
    });

    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledTimes(1);
    expect(fakes.fakeSuggestions.reconcileCanonicalChange).toHaveBeenCalledWith({
      targetKind: 'object',
      targetId: OTHER_OBJECT_ID,
      operation: 'archive_or_cancel',
      reason: 'A teammate archived this object directly.',
    });
    expectApprovalsRevalidated();
  });

  it('does not refresh cleanup surfaces when bulk archive transaction fails', async () => {
    const err = new Error('archive failed');
    fakes.fakeTransactionObjects.archiveObject.mockRejectedValueOnce(err);

    await expect(bulkArchiveObjectsAction({ ids: [OBJECT_ID, OTHER_OBJECT_ID] })).resolves.toEqual({
      error: 'archive failed',
    });

    expect(fakes.fakeTransaction).toHaveBeenCalledTimes(1);
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalledWith('/app/objects');
  });

  it('merges selected objects with a survivor and refreshes old and new object pages', async () => {
    await expect(
      mergeObjectsAction({ survivorId: OBJECT_ID, mergedIds: [OTHER_OBJECT_ID] }),
    ).resolves.toEqual({ ok: true, id: OBJECT_ID });

    expect(fakes.fakeObjects.mergeObjects).toHaveBeenCalledWith({
      survivorId: OBJECT_ID,
      mergedIds: [OTHER_OBJECT_ID],
      actor: { kind: 'user', userId: USER_ID },
    });
    expect(fakes.fakeSuggestions.reconcileObjectMerge).toHaveBeenCalledWith({
      survivorId: OBJECT_ID,
      mergedIds: [OTHER_OBJECT_ID],
      reason: 'A teammate merged these objects directly.',
    });
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OTHER_OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
  });

  it('accepts merge suggestions through the merge preview action', async () => {
    const suggestionItemId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    await expect(
      mergeObjectsAction({ survivorId: OBJECT_ID, mergedIds: [OTHER_OBJECT_ID], suggestionItemId }),
    ).resolves.toEqual({ ok: true, id: OBJECT_ID });

    expect(fakes.fakeObjects.mergeObjects).not.toHaveBeenCalled();
    expect(fakes.fakeSuggestions.acceptObjectMergeSuggestionItem).toHaveBeenCalledWith({
      itemId: suggestionItemId,
      survivorId: OBJECT_ID,
      mergedIds: [OTHER_OBJECT_ID],
    });
    expect(fakes.fakeSuggestions.reconcileObjectMerge).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
  });

  it('queues a manual object cleanup suggestion scan for the active team', async () => {
    const { findObjectCleanupSuggestionsAction } = await import('@/app/actions/objects');

    await expect(findObjectCleanupSuggestionsAction()).resolves.toEqual({
      ok: true,
      message: 'Scan queued',
    });

    expect(fakes.fakeEnqueueSuggestionJob).toHaveBeenCalledWith(
      {
        scope: 'object_cleanup',
        teamId: '11111111-1111-4111-8111-111111111111',
        triggeredBy: 'manual',
      },
      { jobIdSuffix: 'manual' },
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
  });

  it('reports when a manual object cleanup scan is already queued', async () => {
    fakes.fakeEnqueueSuggestionJob.mockResolvedValueOnce({
      enqueued: false,
      jobId: 'object-cleanup|team|manual|manual',
    });
    const { findObjectCleanupSuggestionsAction } = await import('@/app/actions/objects');

    await expect(findObjectCleanupSuggestionsAction()).resolves.toEqual({
      ok: true,
      message: 'Scan already queued',
    });

    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/objects');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
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
    ).resolves.toEqual({ ok: true, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
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

  it('treats missing relationship rows as link failures', async () => {
    fakes.fakeObjects.addRelationship.mockResolvedValueOnce(null);

    await expect(
      addRelationshipAction({
        fromEntityId: OBJECT_ID,
        toEntityId: OTHER_OBJECT_ID,
        kind: 'related',
      }),
    ).resolves.toEqual({ error: 'Relationship could not be created' });
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
