'use server';
import * as objects from '@timeline/shared/objects';
import { enqueueSuggestionJob } from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { db } from '@/lib/db';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

// Derived from the Postgres enum so adding a new object type doesn't
// require synchronizing this schema with the drizzle enum by hand.
const objectTypeSchema = z.enum(objects.OBJECT_TYPES);

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
  reportCaughtError(err, {
    surface: 'server_action',
    operation: fallback.toLowerCase().replace(/\s+/g, '_'),
  });
  return err instanceof Error ? err.message : fallback;
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
      revalidatePath('/app/objects');
      if (parsed.data.parentObjectId) {
        revalidatePath(`/app/objects/${parsed.data.parentObjectId}`);
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
      await r.scope.objects.updateObject(
        id,
        {
          ...rest,
          ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        },
        { kind: 'user', userId: r.userId },
      );
      revalidatePath('/app/objects');
      revalidatePath(`/app/objects/${id}`);
      // Kanban drag-to-move triggers updateObjectAction from a board page.
      // Without these the optimistic update snaps back to the stale rows
      // prop on `router.refresh()` and the card visibly jumps back to its
      // original column. `layout` scope covers all `/app/boards/[id]`
      // permutations without needing the id here.
      revalidatePath('/app/boards', 'layout');
      revalidatePath('/app/tasks');
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
      await r.scope.objects.archiveObject(parsed.data.id, { kind: 'user', userId: r.userId });
      revalidatePath('/app/objects');
      revalidatePath(`/app/objects/${parsed.data.id}`);
      // Archived objects must drop out of any board/kanban view that was
      // surfacing them. Matches the revalidation set in updateObjectAction.
      revalidatePath('/app/boards', 'layout');
      revalidatePath('/app/tasks');
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
      await db.transaction(async (tx) => {
        const txScope = withTeam(tx as unknown as typeof db, r.teamId, r.userId);
        for (const id of ids) {
          await txScope.objects.archiveObject(id, { kind: 'user', userId: r.userId });
        }
      });
      for (const id of ids) revalidatePath(`/app/objects/${id}`);
      revalidatePath('/app/objects');
      revalidatePath('/app/boards', 'layout');
      revalidatePath('/app/tasks');
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
      revalidatePath('/app/objects');
      revalidatePath('/app/approvals');
      revalidatePath('/app/inbox');
      revalidatePath(`/app/objects/${survivorId}`);
      for (const id of parsed.data.mergedIds) revalidatePath(`/app/objects/${id}`);
      revalidatePath('/app/boards', 'layout');
      revalidatePath('/app/tasks');
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
      revalidatePath('/app/objects');
      revalidatePath('/app/approvals');
      revalidatePath('/app/inbox');
      return {
        ok: true,
        message: result.enqueued ? 'Scan queued' : 'Scan already queued',
      };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to find cleanup suggestions') };
    }
  });
}

const relationshipSchema = z.object({
  fromEntityId: uuidSchema,
  toEntityId: uuidSchema,
  kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of', 'linked']),
});

export async function addRelationshipAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('add_relationship', async () => {
    const parsed = relationshipSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.objects.addRelationship({
        ...parsed.data,
        actorUserId: r.userId,
      });
      revalidatePath(`/app/objects/${parsed.data.fromEntityId}`);
      revalidatePath(`/app/objects/${parsed.data.toEntityId}`);
      return { ok: true };
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
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      // Revalidate the peer's detail page too — addRelationshipAction does
      // the same, otherwise the other side keeps showing the now-deleted
      // link until the user navigates away.
      if (parsed.data.otherEntityId) {
        revalidatePath(`/app/objects/${parsed.data.otherEntityId}`);
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

export async function createNoteAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('create_note', async () => {
    const parsed = noteCreateSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const note = await r.scope.objects.createNote({
        ...parsed.data,
        authorUserId: r.userId,
      });
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      return { ok: true, id: note.id };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to add note') };
    }
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
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      return ok ? { ok: true } : { error: 'Note not found' };
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
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      return ok ? { ok: true } : { error: 'Note not found' };
    } catch (err) {
      return { error: friendlyError(err, 'Failed to delete note') };
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
      revalidatePath('/app/inbox');
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
      revalidatePath('/app/inbox');
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
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      revalidatePath('/app/inbox');
      // Accepting may change status / stage / priority — same revalidation
      // set as updateObjectAction so kanban / task columns reflect the move.
      revalidatePath('/app/objects');
      revalidatePath('/app/boards', 'layout');
      revalidatePath('/app/tasks');
      return ok ? { ok: true } : { error: 'Suggestion no longer pending' };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'accept_object_change' });
      return { error: err instanceof Error ? err.message : 'Failed to accept' };
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
      revalidatePath(`/app/objects/${parsed.data.entityId}`);
      revalidatePath('/app/inbox');
      return ok ? { ok: true } : { error: 'Suggestion no longer pending' };
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'reject_object_change' });
      return { error: err instanceof Error ? err.message : 'Failed to reject' };
    }
  });
}
