import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  bulkArchiveObjectsAction,
  createNoteAction,
  createObjectAction,
  deleteNoteAction,
  generateObjectSummaryAction,
  loadTaskRowsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  mergeObjectsAction,
  rejectObjectChangeAction,
  removeRelationshipAction,
  repairObjectMemoryAction,
  resetTaskCategoryAction,
  retryTaskCategoryAction,
  searchObjectsAction,
  setTaskCategoryAction,
  undoTaskCategoryChangeAction,
  setTaskProjectAction,
  updateNoteAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { expectPublicActionErrorReport } from '@/test/public-error';

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
  fakeCheckRateLimit: vi.fn(),
  fakeObjects: {
    createObject: vi.fn(),
    getObject: vi.fn(),
    updateObject: vi.fn(),
    archiveObject: vi.fn(),
    mergeObjects: vi.fn(),
    addRelationship: vi.fn(),
    removeRelationship: vi.fn(),
    setTaskCategory: vi.fn(),
    undoTaskCategoryChange: vi.fn(),
    resetTaskCategoryToAutomatic: vi.fn(),
    retryTaskCategory: vi.fn(),
    setTaskProject: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    enqueueObjectSummaryRefresh: vi.fn(),
    listObjects: vi.fn(),
    countObjects: vi.fn(),
    searchObjects: vi.fn(),
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
vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: { search: { capacity: 30, refillPerSec: 0.5 } },
  checkRateLimit: fakes.fakeCheckRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
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

function expectWorkRevalidated(): void {
  expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/work');
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
  fakes.fakeObjects.getObject.mockResolvedValue({ id: OBJECT_ID, archivedAt: null });
  fakes.fakeObjects.updateObject.mockResolvedValue({
    object: { id: OBJECT_ID, type: 'task' },
    changedFields: ['status', 'dueAt'],
  });
  fakes.fakeObjects.archiveObject.mockResolvedValue({
    id: OBJECT_ID,
    type: 'task',
    changedFields: ['archivedAt'],
  });
  fakes.fakeObjects.setTaskProject.mockResolvedValue({
    changed: true,
    project: null,
    touchedIds: [OBJECT_ID],
  });
  fakes.fakeObjects.setTaskCategory.mockResolvedValue({
    object: { id: OBJECT_ID },
    changeId: CHANGE_ID,
  });
  fakes.fakeObjects.undoTaskCategoryChange.mockResolvedValue({
    id: OBJECT_ID,
    taskCategoryMode: 'automatic',
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
  fakes.fakeObjects.enqueueObjectSummaryRefresh.mockResolvedValue({
    enqueued: true,
    jobId: 'summary-job',
    canGenerate: true,
    reason: null,
  });
  fakes.fakeObjects.listObjects.mockResolvedValue([
    {
      id: OBJECT_ID,
      canonicalName: 'Current Object',
      type: 'project',
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
      archivedAt: null,
      aliases: [],
      metadata: {},
      updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    },
    {
      id: OTHER_OBJECT_ID,
      canonicalName: 'Other Object',
      type: 'company',
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
      archivedAt: null,
      aliases: [],
      metadata: {},
      updatedAt: new Date('2026-05-01T10:00:00.000Z'),
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
    },
  ]);
  fakes.fakeObjects.countObjects.mockResolvedValue(2);
  fakes.fakeObjects.searchObjects.mockResolvedValue([
    { id: OBJECT_ID, canonicalName: 'Current Object', type: 'project' },
    { id: OTHER_OBJECT_ID, canonicalName: 'Acme Corporation', type: 'company' },
  ]);
  fakes.fakeCheckRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
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

describe('searchObjectsAction', () => {
  it('uses indexed object search for non-empty queries and excludes the current object', async () => {
    await expect(
      searchObjectsAction({ query: 'acme company', exclude: OBJECT_ID }),
    ).resolves.toEqual({
      results: [{ id: OTHER_OBJECT_ID, canonicalName: 'Acme Corporation', type: 'company' }],
    });

    expect(fakes.fakeObjects.searchObjects).toHaveBeenCalledWith({
      query: 'acme company',
      archived: false,
      limit: 13,
    });
    expect(fakes.fakeObjects.listObjects).not.toHaveBeenCalled();
  });

  it('lists recent active objects for empty queries', async () => {
    await expect(searchObjectsAction({ query: '' })).resolves.toEqual({
      results: [
        { id: OBJECT_ID, canonicalName: 'Current Object', type: 'project' },
        { id: OTHER_OBJECT_ID, canonicalName: 'Other Object', type: 'company' },
      ],
    });

    expect(fakes.fakeObjects.listObjects).toHaveBeenCalledWith({ archived: false, limit: 13 });
    expect(fakes.fakeObjects.searchObjects).not.toHaveBeenCalled();
  });

  it('returns no results when object search is rate limited', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    await expect(searchObjectsAction({ query: 'acme' })).resolves.toEqual({ results: [] });

    expect(fakes.fakeObjects.searchObjects).not.toHaveBeenCalled();
    expect(fakes.fakeObjects.listObjects).not.toHaveBeenCalled();
  });
});

describe('loadTaskRowsAction', () => {
  it('loads a cursor-paginated task window', async () => {
    const result = await loadTaskRowsAction({ cursor: 'older' });

    expect(result.nextCursor).toBeNull();
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: OBJECT_ID, canonicalName: 'Current Object' }),
      ]),
    );

    expect(fakes.fakeObjects.listObjects).toHaveBeenCalledWith({
      type: 'task',
      archived: false,
      limit: 501,
      cursor: 'older',
    });
  });

  it('does not hit object scope when task loading is rate limited', async () => {
    fakes.fakeCheckRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 2500 });

    await expect(loadTaskRowsAction({ cursor: null })).resolves.toEqual({
      rows: [],
      nextCursor: null,
      error: 'Too many task loads. Try again shortly.',
    });

    expect(fakes.fakeObjects.listObjects).not.toHaveBeenCalled();
  });
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
    expectWorkRevalidated();
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

    const result = await createObjectAction({ type: 'task', canonicalName: 'Follow up' });
    expect(result.error).toMatch(/^Failed to create object Reference: [0-9a-f]{8}\.$/);
    expectPublicActionErrorReport(fakes.fakeReportCaughtError, err, 'failed_to_create_object');
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
    expectWorkRevalidated();
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/boards', 'layout');
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/tasks');
    expectApprovalsRevalidated();
  });

  it('reports manual summary requests that are already queued', async () => {
    fakes.fakeObjects.enqueueObjectSummaryRefresh.mockResolvedValueOnce({
      enqueued: false,
      jobId: 'summary-job',
      canGenerate: true,
      reason: null,
    });

    await expect(generateObjectSummaryAction({ entityId: OBJECT_ID })).resolves.toEqual({
      error: 'Summary generation is already queued',
    });
    expect(fakes.fakeObjects.enqueueObjectSummaryRefresh).toHaveBeenCalledWith(OBJECT_ID, {
      trigger: 'manual',
    });
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
  });

  it('reports missing objects distinctly when manual summary generation cannot load the object', async () => {
    fakes.fakeObjects.enqueueObjectSummaryRefresh.mockResolvedValueOnce({
      enqueued: false,
      jobId: null,
      canGenerate: false,
      reason: 'not_found',
    });

    await expect(generateObjectSummaryAction({ entityId: OBJECT_ID })).resolves.toEqual({
      error: 'Object not found',
    });
    expect(fakes.fakeObjects.enqueueObjectSummaryRefresh).toHaveBeenCalledWith(OBJECT_ID, {
      trigger: 'manual',
    });
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
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
    expectWorkRevalidated();
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
    expectWorkRevalidated();
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
    expectWorkRevalidated();
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

    const result = await bulkArchiveObjectsAction({ ids: [OBJECT_ID, OTHER_OBJECT_ID] });
    expect(result.error).toMatch(/^Failed to archive selected objects Reference: [0-9a-f]{8}\.$/);

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
    expectWorkRevalidated();
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
    expectWorkRevalidated();
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

  it('queues object-scoped memory repair for the active team', async () => {
    await expect(repairObjectMemoryAction({ id: OBJECT_ID })).resolves.toEqual({
      ok: true,
      message: 'Memory repair queued',
    });

    expect(fakes.fakeEnqueueSuggestionJob).toHaveBeenCalledWith(
      {
        scope: 'object_cleanup',
        teamId: '11111111-1111-4111-8111-111111111111',
        objectId: OBJECT_ID,
        triggeredBy: 'memory_repair',
      },
      { jobIdSuffix: `memory-repair:${OBJECT_ID}` },
    );
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
    expect(fakes.fakeRevalidatePath).toHaveBeenCalledWith('/app/approvals');
  });

  it('does not queue object-scoped memory repair for archived objects', async () => {
    fakes.fakeObjects.getObject.mockResolvedValueOnce({
      id: OBJECT_ID,
      archivedAt: new Date('2026-06-02T10:00:00.000Z'),
    });

    await expect(repairObjectMemoryAction({ id: OBJECT_ID })).resolves.toEqual({
      error: 'Repair memory is unavailable for archived objects',
    });

    expect(fakes.fakeEnqueueSuggestionJob).not.toHaveBeenCalled();
    expect(fakes.fakeRevalidatePath).not.toHaveBeenCalledWith(`/app/objects/${OBJECT_ID}`);
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

  it('keeps optimistic relationship creates successful when revalidation fails after persistence', async () => {
    const err = new Error('cache unavailable');
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw err;
    });

    await expect(
      addRelationshipAction({
        fromEntityId: OBJECT_ID,
        toEntityId: OTHER_OBJECT_ID,
        kind: 'related',
      }),
    ).resolves.toEqual({ ok: true, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    expect(fakes.fakeObjects.addRelationship).toHaveBeenCalled();
    expect(fakes.fakeReportCaughtError).toHaveBeenCalledWith(err, {
      surface: 'server_action',
      operation: 'revalidate_object_relationship',
    });
  });

  it('keeps optimistic relationship removals successful when revalidation fails after persistence', async () => {
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(
      removeRelationshipAction({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        entityId: OBJECT_ID,
        otherEntityId: OTHER_OBJECT_ID,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeObjects.removeRelationship).toHaveBeenCalled();
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

  it('keeps created notes successful when post-create revalidation fails', async () => {
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(createNoteAction({ entityId: OBJECT_ID, body: 'Note' })).resolves.toEqual({
      ok: true,
      id: NOTE_ID,
    });
    expect(fakes.fakeObjects.createNote).toHaveBeenCalledWith({
      entityId: OBJECT_ID,
      body: 'Note',
      authorUserId: USER_ID,
    });
  });

  it('keeps optimistic note edits successful when post-mutation revalidation fails', async () => {
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(
      updateNoteAction({ noteId: NOTE_ID, entityId: OBJECT_ID, body: 'Updated' }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeObjects.updateNote).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      body: 'Updated',
      actorUserId: USER_ID,
    });
  });

  it('keeps optimistic note deletes successful when post-mutation revalidation fails', async () => {
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(deleteNoteAction({ noteId: NOTE_ID, entityId: OBJECT_ID })).resolves.toEqual({
      ok: true,
    });
    expect(fakes.fakeObjects.deleteNote).toHaveBeenCalledWith({
      noteId: NOTE_ID,
      actorUserId: USER_ID,
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
    expectWorkRevalidated();
  });

  it('keeps optimistic suggestion accept/reject successful when revalidation fails after persistence', async () => {
    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(
      acceptObjectChangeAction({ changeId: CHANGE_ID, entityId: OBJECT_ID }),
    ).resolves.toEqual({ ok: true });

    fakes.fakeRevalidatePath.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    await expect(
      rejectObjectChangeAction({ changeId: CHANGE_ID, entityId: OBJECT_ID }),
    ).resolves.toEqual({ ok: true });
    expect(fakes.fakeObjects.acceptObjectChange).toHaveBeenCalledWith(CHANGE_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.rejectObjectChange).toHaveBeenCalledWith(CHANGE_ID);
  });

  it('validates and routes category authority and primary project mutations', async () => {
    await expect(
      setTaskCategoryAction({ id: OBJECT_ID, category: 'engineering' }),
    ).resolves.toEqual({ ok: true, id: OBJECT_ID, undoChangeId: CHANGE_ID });
    await expect(
      undoTaskCategoryChangeAction({ id: OBJECT_ID, changeId: CHANGE_ID }),
    ).resolves.toEqual({ ok: true, id: OBJECT_ID });
    await expect(resetTaskCategoryAction({ id: OBJECT_ID })).resolves.toEqual({
      ok: true,
      id: OBJECT_ID,
    });
    await expect(retryTaskCategoryAction({ id: OBJECT_ID })).resolves.toEqual({
      ok: true,
      id: OBJECT_ID,
    });
    await expect(
      setTaskProjectAction({ id: OBJECT_ID, projectId: OTHER_OBJECT_ID }),
    ).resolves.toEqual({ ok: true, id: OBJECT_ID });

    expect(fakes.fakeObjects.setTaskCategory).toHaveBeenCalledWith(OBJECT_ID, 'engineering', {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.undoTaskCategoryChange).toHaveBeenCalledWith(OBJECT_ID, CHANGE_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.resetTaskCategoryToAutomatic).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.retryTaskCategory).toHaveBeenCalledWith(OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    expect(fakes.fakeObjects.setTaskProject).toHaveBeenCalledWith(OBJECT_ID, OTHER_OBJECT_ID, {
      kind: 'user',
      userId: USER_ID,
    });
    await expect(setTaskCategoryAction({ id: OBJECT_ID, category: 'not-real' })).resolves.toEqual({
      error: 'Invalid task category',
    });
  });
});
