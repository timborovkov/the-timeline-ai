'use server';
import * as objects from '@timeline/shared/objects';
import { enqueueSuggestionJob } from '@timeline/shared/queue';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { db } from '@/lib/db';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';
import { loadTaskRowsPage } from '@/lib/task-page';
import { parseWorkFilters, taskObjectFilterFromWorkFilters } from '@/lib/work-filters';

// Derived from the Postgres enum so adding a new object type doesn't
// require synchronizing this schema with the drizzle enum by hand.
const objectTypeSchema = z.enum(objects.OBJECT_TYPES);
const searchObjectsSchema = z.object({
  query: z.string().max(200).default(''),
  exclude: uuidSchema.optional(),
});

type ObjectSuggestionTargetKind = 'object' | 'task';

interface ObjectReconciliationScope {
  reconcileCanonicalChange(input: {
    targetKind: ObjectSuggestionTargetKind;
    targetId: string;
    operation?: 'update' | 'archive_or_cancel';
    patch?: Record<string, unknown>;
    reason?: string;
  }): Promise<number>;
  reconcileObjectMerge(input: {
    survivorId: string;
    mergedIds: string[];
    reason?: string;
  }): Promise<number>;
}

function objectSuggestionTargetKind(type: string): ObjectSuggestionTargetKind {
  return type === 'task' ? 'task' : 'object';
}

async function reconcileObjectUpdate(
  suggestions: ObjectReconciliationScope,
  args: { id: string; type: string; changedFields: string[] },
): Promise<void> {
  if (args.changedFields.length === 0) return;
  await suggestions.reconcileCanonicalChange({
    targetKind: objectSuggestionTargetKind(args.type),
    targetId: args.id,
    operation: 'update',
    patch: Object.fromEntries(args.changedFields.map((field) => [field, true])),
    reason: 'A teammate updated this object directly.',
  });
}

async function reconcileCanonicalChangeBestEffort(
  operation: string,
  task: () => Promise<void>,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    reportCaughtError(err, {
      surface: 'server_action',
      operation,
    });
  }
}

async function reconcileArchivedObject(
  suggestions: ObjectReconciliationScope,
  archived: { id: string; type: string; changedFields?: string[] },
): Promise<void> {
  if (archived.changedFields && !archived.changedFields.includes('archivedAt')) return;
  await suggestions.reconcileCanonicalChange({
    targetKind: objectSuggestionTargetKind(archived.type),
    targetId: archived.id,
    operation: 'archive_or_cancel',
    reason: 'A teammate archived this object directly.',
  });
}

function bestEffortRevalidatePath(
  path: string,
  operation: string,
  type?: Parameters<typeof revalidatePath>[1],
): void {
  try {
    if (type) revalidatePath(path, type);
    else revalidatePath(path);
  } catch (err) {
    reportCaughtError(err, { surface: 'server_action', operation });
  }
}

function revalidateObjectMutationSurfaces(ids: string | string[]): void {
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    bestEffortRevalidatePath(`/app/objects/${id}`, 'revalidate_object_mutation_surfaces');
  }
  bestEffortRevalidatePath('/app/objects', 'revalidate_object_mutation_surfaces');
  bestEffortRevalidatePath('/app/work', 'revalidate_object_mutation_surfaces');
  // Board pages receive object rows through layout data; refresh the layout so
  // optimistic updates do not snap back to stale cards.
  bestEffortRevalidatePath('/app/boards', 'revalidate_object_mutation_surfaces', 'layout');
  bestEffortRevalidatePath('/app/tasks', 'revalidate_object_mutation_surfaces');
  bestEffortRevalidatePath('/app/approvals', 'revalidate_object_mutation_surfaces');
}

const OBJECT_SEARCH_RESULT_LIMIT = 12;
const loadTaskRowsSchema = z.object({
  cursor: z.string().max(500).nullable().optional(),
  filters: z
    .record(z.string(), z.union([z.string(), z.array(z.string()), z.undefined()]))
    .optional(),
});

async function checkUserSearchRateLimit(userId: string): Promise<boolean> {
  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('search', 'user', userId),
    ...rateLimit.RATE_LIMITS.search,
  });
  return rl.ok;
}

export async function searchObjectsAction(input: unknown): Promise<{
  results: { id: string; canonicalName: string; type: string }[];
}> {
  return runSentryServerAction('search_objects', async () => {
    const parsed = searchObjectsSchema.safeParse(input);
    if (!parsed.success) return { results: [] };
    const r = await resolveScope();
    if (!r.ok) return { results: [] };
    if (!(await checkUserSearchRateLimit(r.userId))) return { results: [] };
    const query = parsed.data.query.trim();
    const rows = query
      ? await r.scope.objects.searchObjects({
          query,
          archived: false,
          limit: OBJECT_SEARCH_RESULT_LIMIT + 1,
        })
      : await r.scope.objects.listObjects({
          archived: false,
          limit: OBJECT_SEARCH_RESULT_LIMIT + 1,
        });
    const results: { id: string; canonicalName: string; type: string }[] = [];
    for (const row of rows) {
      if (row.id === parsed.data.exclude) continue;
      results.push({
        id: row.id,
        canonicalName: row.canonicalName,
        type: row.type,
      });
      if (results.length >= OBJECT_SEARCH_RESULT_LIMIT) break;
    }
    return { results };
  });
}

export async function loadTaskRowsAction(input: unknown): Promise<{
  rows: objects.ObjectRow[];
  nextCursor: string | null;
  error?: string;
}> {
  return runSentryServerAction('load_task_rows', async () => {
    const parsed = loadTaskRowsSchema.safeParse(input);
    if (!parsed.success) return { rows: [], nextCursor: null, error: 'Invalid cursor' };
    const r = await resolveScope();
    if (!r.ok) return { rows: [], nextCursor: null, error: r.error };
    if (!(await checkUserSearchRateLimit(r.userId))) {
      return { rows: [], nextCursor: null, error: 'Too many task loads. Try again shortly.' };
    }
    const filters = taskObjectFilterFromWorkFilters(parseWorkFilters(parsed.data.filters ?? {}));
    const page = await loadTaskRowsPage(r.scope.objects, parsed.data.cursor ?? null, filters);
    return {
      rows: page.rows,
      nextCursor: page.nextCursor,
    };
  });
}

/**
 * Map opaque Postgres error codes to UI-friendly messages. drizzle/postgres-js
 * exposes `err.code` (the 5-char SQLSTATE) on driver errors. Without this
 * mapping, the user sees the raw 'duplicate key value violates unique
 * constraint "entities_team_type_canonical_name_unq"' string in the toast.
 */
function friendlyError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === '23505') return 'An object with that name already exists.';
    if (code === '23503') return 'Linked record no longer exists.';
    if (code === '23514') return 'Value violates a constraint.';
  }
  return publicActionError(err, {
    operation: fallback.toLowerCase().replace(/\s+/g, '_'),
    fallback,
  });
}

const createObjectSchema = z.object({
  type: objectTypeSchema,
  canonicalName: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(40).optional(),
  ownerUserId: uuidSchema.nullable().optional(),
  assigneeUserId: uuidSchema.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  parentObjectId: uuidSchema.nullable().optional(),
});

export async function createObjectAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('create_object', async () => {
    const parsed = createObjectSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };

    try {
      const obj = await r.scope.objects.createObject({
        type: parsed.data.type,
        canonicalName: parsed.data.canonicalName,
        status: parsed.data.status,
        ownerUserId: parsed.data.ownerUserId ?? null,
        assigneeUserId: parsed.data.assigneeUserId ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        parentObjectId: parsed.data.parentObjectId ?? null,
        actor: { kind: 'user', userId: r.userId },
      });
      bestEffortRevalidatePath('/app/objects', 'revalidate_object_create');
      bestEffortRevalidatePath('/app/work', 'revalidate_object_create');
      if (parsed.data.parentObjectId) {
        bestEffortRevalidatePath(
          `/app/objects/${parsed.data.parentObjectId}`,
          'revalidate_object_create',
        );
      }
      trackProductEventBestEffort(r.userId, 'object_created', {
        teamId: r.teamId,
        userId: r.userId,
        objectId: obj.id,
        objectType: parsed.data.type,
        hasParent: Boolean(parsed.data.parentObjectId),
      });
      return { ok: true, id: obj.id };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to create object') };
    }
  });
}

const updateObjectSchema = z.object({
  id: uuidSchema,
  canonicalName: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuidSchema.nullable().optional(),
  assigneeUserId: uuidSchema.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export async function updateObjectAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('update_object', async () => {
    const parsed = updateObjectSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };

    const { id, dueAt, ...rest } = parsed.data;
    try {
      const patch = {
        ...rest,
        ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
      };
      const result = await r.scope.objects.updateObject(id, patch, {
        kind: 'user',
        userId: r.userId,
      });
      await reconcileCanonicalChangeBestEffort('reconcile_object_update_after_update', () =>
        reconcileObjectUpdate(r.scope.suggestions, {
          id,
          type: result.object.type,
          changedFields: result.changedFields,
        }),
      );
      revalidateObjectMutationSurfaces(id);
      return { ok: true, id };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to update object') };
    }
  });
}

export async function archiveObjectAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('archive_object', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const archived = await r.scope.objects.archiveObject(parsed.data.id, {
        kind: 'user',
        userId: r.userId,
      });
      await reconcileCanonicalChangeBestEffort('reconcile_object_archive_after_archive', () =>
        reconcileArchivedObject(r.scope.suggestions, archived),
      );
      revalidateObjectMutationSurfaces(parsed.data.id);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to archive') };
    }
  });
}

const bulkObjectIdsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(50),
});

export async function bulkArchiveObjectsAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('bulk_archive_objects', async () => {
    const parsed = bulkObjectIdsSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ids = Array.from(new Set(parsed.data.ids));
      const archivedObjects = await db.transaction(async (tx) => {
        const txScope = withTeam(tx as unknown as typeof db, r.teamId, r.userId);
        return ids.reduce(
          (previous, id) =>
            previous.then((archived) =>
              txScope.objects
                .archiveObject(id, { kind: 'user', userId: r.userId })
                .then((object) => [...archived, object]),
            ),
          Promise.resolve([] as Awaited<ReturnType<typeof txScope.objects.archiveObject>>[]),
        );
      });
      await Promise.all(
        archivedObjects.map((archived) =>
          reconcileCanonicalChangeBestEffort('reconcile_object_archive_after_bulk_archive', () =>
            reconcileArchivedObject(r.scope.suggestions, archived),
          ),
        ),
      );
      revalidateObjectMutationSurfaces(ids);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to archive selected objects') };
    }
  });
}

const mergeObjectsSchema = z.object({
  survivorId: uuidSchema,
  mergedIds: z.array(uuidSchema).min(1).max(9),
  suggestionItemId: uuidSchema.optional(),
});

export async function mergeObjectsAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('merge_objects', async () => {
    const parsed = mergeObjectsSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const result = parsed.data.suggestionItemId
        ? await r.scope.suggestions.acceptObjectMergeSuggestionItem({
            itemId: parsed.data.suggestionItemId,
            survivorId: parsed.data.survivorId,
            mergedIds: parsed.data.mergedIds,
          })
        : await r.scope.objects.mergeObjects({
            survivorId: parsed.data.survivorId,
            mergedIds: parsed.data.mergedIds,
            actor: { kind: 'user', userId: r.userId },
          });
      if (!result) return { error: 'Merge suggestion is no longer pending.' };
      const survivorId = 'survivor' in result ? result.survivor.id : result.survivorId;
      if (!parsed.data.suggestionItemId) {
        await reconcileCanonicalChangeBestEffort('reconcile_object_merge', async () => {
          await r.scope.suggestions.reconcileObjectMerge({
            survivorId,
            mergedIds: parsed.data.mergedIds,
            reason: 'A teammate merged these objects directly.',
          });
        });
      }
      bestEffortRevalidatePath('/app/objects', 'revalidate_object_merge');
      bestEffortRevalidatePath('/app/work', 'revalidate_object_merge');
      bestEffortRevalidatePath('/app/approvals', 'revalidate_object_merge');
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_merge');
      bestEffortRevalidatePath(`/app/objects/${survivorId}`, 'revalidate_object_merge');
      for (const id of parsed.data.mergedIds) {
        bestEffortRevalidatePath(`/app/objects/${id}`, 'revalidate_object_merge');
      }
      bestEffortRevalidatePath('/app/boards', 'revalidate_object_merge', 'layout');
      bestEffortRevalidatePath('/app/tasks', 'revalidate_object_merge');
      return { ok: true, id: survivorId };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to merge objects') };
    }
  });
}

export async function findObjectCleanupSuggestionsAction(): Promise<ActionState> {
  return runSentryServerAction('find_object_cleanup_suggestions', async () => {
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const result = await enqueueSuggestionJob(
        {
          scope: 'object_cleanup',
          teamId: r.teamId,
          triggeredBy: 'manual',
        },
        { jobIdSuffix: 'manual' },
      );
      bestEffortRevalidatePath('/app/objects', 'revalidate_object_cleanup_scan');
      bestEffortRevalidatePath('/app/approvals', 'revalidate_object_cleanup_scan');
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_cleanup_scan');
      return {
        ok: true,
        message: result.enqueued ? 'Scan queued' : 'Scan already queued',
      };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to find cleanup suggestions') };
    }
  });
}

export async function repairObjectMemoryAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('repair_object_memory', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const object = await r.scope.objects.getObject(parsed.data.id);
      if (!object) return { error: 'Object not found' };
      if (object.archivedAt) return { error: 'Repair memory is unavailable for archived objects' };
      const result = await enqueueSuggestionJob(
        {
          scope: 'object_cleanup',
          teamId: r.teamId,
          objectId: parsed.data.id,
          triggeredBy: 'memory_repair',
        },
        { jobIdSuffix: `memory-repair:${parsed.data.id}` },
      );
      bestEffortRevalidatePath(`/app/objects/${parsed.data.id}`, 'revalidate_object_memory_repair');
      bestEffortRevalidatePath('/app/approvals', 'revalidate_object_memory_repair');
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_memory_repair');
      return {
        ok: true,
        message: result.enqueued ? 'Memory repair queued' : 'Memory repair already queued',
      };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to repair memory') };
    }
  });
}

const relationshipSchema = z.object({
  fromEntityId: uuidSchema,
  toEntityId: uuidSchema,
  kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of']),
});

export async function addRelationshipAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('add_relationship', async () => {
    const parsed = relationshipSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const relationship = await r.scope.objects.addRelationship({
        ...parsed.data,
        actorUserId: r.userId,
      });
      if (!relationship) return { error: 'Relationship could not be created' };
      bestEffortRevalidateObjectDetail(parsed.data.fromEntityId, 'revalidate_object_relationship');
      bestEffortRevalidateObjectDetail(parsed.data.toEntityId, 'revalidate_object_relationship');
      return { ok: true, id: relationship.id };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to link') };
    }
  });
}

export async function removeRelationshipAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('remove_relationship', async () => {
    const parsed = z
      .object({ id: uuidSchema, entityId: uuidSchema, otherEntityId: uuidSchema.optional() })
      .safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.removeRelationship(parsed.data.id, {
        kind: 'user',
        userId: r.userId,
      });
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_relationship');
      // Revalidate the peer's detail page too — addRelationshipAction does
      // the same, otherwise the other side keeps showing the now-deleted
      // link until the user navigates away.
      if (parsed.data.otherEntityId) {
        bestEffortRevalidateObjectDetail(
          parsed.data.otherEntityId,
          'revalidate_object_relationship',
        );
      }
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to unlink') };
    }
  });
}

// ---------- Notes ----------

const noteCreateSchema = z.object({
  entityId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
});

function bestEffortRevalidateObjectDetail(entityId: string, operation: string): void {
  bestEffortRevalidatePath(`/app/objects/${entityId}`, operation);
}

export async function createNoteAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('create_note', async () => {
    const parsed = noteCreateSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    let note: { id: string };
    try {
      note = await r.scope.objects.createNote({
        ...parsed.data,
        authorUserId: r.userId,
      });
    } catch (err) {
      return { error: friendlyError(err, 'Failed to add note') };
    }
    bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_note');
    return { ok: true, id: note.id };
  });
}

const noteUpdateSchema = z.object({
  noteId: uuidSchema,
  entityId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
});

export async function updateNoteAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('update_note', async () => {
    const parsed = noteUpdateSchema.safeParse(input);
    if (!parsed.success) return { error: 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.objects.updateNote({
        noteId: parsed.data.noteId,
        body: parsed.data.body,
        actorUserId: r.userId,
      });
      if (!ok) return { error: 'Note not found' };
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_note');
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to update note') };
    }
  });
}

export async function deleteNoteAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('delete_note', async () => {
    const parsed = z.object({ noteId: uuidSchema, entityId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.objects.deleteNote({
        noteId: parsed.data.noteId,
        actorUserId: r.userId,
      });
      if (!ok) return { error: 'Note not found' };
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_note');
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to delete note') };
    }
  });
}

// ---------- Summaries ----------

export async function generateObjectSummaryAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('generate_object_summary', async () => {
    const parsed = z.object({ entityId: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const result = await r.scope.objects.enqueueObjectSummaryRefresh(parsed.data.entityId, {
        trigger: 'manual',
      });
      if (!result.canGenerate) {
        return {
          error:
            result.reason === 'not_found' ? 'Object not found' : 'Not enough object memory yet',
        };
      }
      if (!result.enqueued) return { error: 'Summary generation is already queued' };
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_summary');
      return { ok: true, id: result.jobId ?? parsed.data.entityId };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to queue summary') };
    }
  });
}

// ---------- Notifications ----------

export async function markNotificationReadAction(id: string): Promise<ActionState> {
  return runSentryServerAction('mark_notification_read', async () => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      // `markNotificationRead` returns false for both "not found" and
      // "already read" (the SQL is guarded by `readAt IS NULL`). Either
      // way the user's desired state — read — is achieved, so always
      // return ok and let the revalidation refresh whatever stale view
      // triggered the click. Wrap in try/catch so a DB failure surfaces
      // as { error } instead of throwing into the client and stranding
      // the optimistic read state.
      await r.scope.objects.markNotificationRead(parsed.data);
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_notification');
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to mark notification read') };
    }
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionState> {
  return runSentryServerAction('mark_all_notifications_read', async () => {
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.markAllNotificationsRead();
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_notification');
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to mark notifications read') };
    }
  });
}

// ---------- Suggestion review ----------

const reviewSuggestionSchema = z.object({
  changeId: uuidSchema,
  entityId: uuidSchema,
});

export async function acceptObjectChangeAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('accept_object_change', async () => {
    const parsed = reviewSuggestionSchema.safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.objects.acceptObjectChange(parsed.data.changeId, {
        kind: 'user',
        userId: r.userId,
      });
      if (!ok) return { error: 'Suggestion no longer pending' };
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_change_accept');
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_change_accept');
      // Accepting may change status / stage / priority — same revalidation
      // set as updateObjectAction so kanban / task columns reflect the move.
      bestEffortRevalidatePath('/app/objects', 'revalidate_object_change_accept');
      bestEffortRevalidatePath('/app/work', 'revalidate_object_change_accept');
      bestEffortRevalidatePath('/app/boards', 'revalidate_object_change_accept', 'layout');
      bestEffortRevalidatePath('/app/tasks', 'revalidate_object_change_accept');
      return { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'accept_object_change',
          fallback: 'Failed to accept object change.',
        }),
      };
    }
  });
}

export async function rejectObjectChangeAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('reject_object_change', async () => {
    const parsed = reviewSuggestionSchema.safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.objects.rejectObjectChange(parsed.data.changeId);
      if (!ok) return { error: 'Suggestion no longer pending' };
      bestEffortRevalidateObjectDetail(parsed.data.entityId, 'revalidate_object_change_reject');
      bestEffortRevalidatePath('/app/inbox', 'revalidate_object_change_reject');
      return { ok: true };
    } catch (err) {
      return {
        error: publicActionError(err, {
          operation: 'reject_object_change',
          fallback: 'Failed to reject object change.',
        }),
      };
    }
  });
}
