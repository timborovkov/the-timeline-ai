'use server';

import { objects, withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

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
  return err instanceof Error ? err.message : fallback;
}

const createObjectSchema = z.object({
  type: objectTypeSchema,
  canonicalName: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(40).optional(),
  ownerUserId: uuidSchema.nullable().optional(),
  assigneeUserId: uuidSchema.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  parentObjectId: uuidSchema.nullable().optional(),
});

interface ActionState {
  error?: string;
  ok?: boolean;
  id?: string;
}

type ResolvedScope =
  | { ok: false; error: string }
  | { ok: true; scope: ReturnType<typeof withTeam>; userId: string };

async function resolveScope(): Promise<ResolvedScope> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { ok: false, error: 'No active team' };
  return {
    ok: true,
    scope: withTeam(db, active.teamId, session.user.id),
    userId: session.user.id,
  };
}

export async function createObjectAction(input: unknown): Promise<ActionState> {
  const parsed = createObjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };

  try {
    const obj = await objects.createObject(db, r.scope, {
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
    return { ok: true, id: obj.id };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to create object') };
  }
}

const updateObjectSchema = z.object({
  id: uuidSchema,
  canonicalName: z.string().trim().min(1).max(200).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  stage: z.string().trim().max(40).nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  ownerUserId: uuidSchema.nullable().optional(),
  assigneeUserId: uuidSchema.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export async function updateObjectAction(input: unknown): Promise<ActionState> {
  const parsed = updateObjectSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };

  const { id, dueAt, ...rest } = parsed.data;
  try {
    await objects.updateObject(
      db,
      r.scope,
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
}

export async function archiveObjectAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ id: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await objects.archiveObject(db, r.scope, parsed.data.id, { kind: 'user', userId: r.userId });
    revalidatePath('/app/objects');
    revalidatePath(`/app/objects/${parsed.data.id}`);
    return { ok: true };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to archive') };
  }
}

const relationshipSchema = z.object({
  fromEntityId: uuidSchema,
  toEntityId: uuidSchema,
  kind: z.enum(['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate_of', 'linked']),
});

export async function addRelationshipAction(input: unknown): Promise<ActionState> {
  const parsed = relationshipSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await objects.addRelationship(db, r.scope, {
      ...parsed.data,
      actorUserId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.fromEntityId}`);
    revalidatePath(`/app/objects/${parsed.data.toEntityId}`);
    return { ok: true };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to link') };
  }
}

export async function removeRelationshipAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ id: uuidSchema, entityId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    await objects.removeRelationship(db, r.scope, parsed.data.id, {
      kind: 'user',
      userId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    return { ok: true };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to unlink') };
  }
}

// ---------- Notes ----------

const noteCreateSchema = z.object({
  entityId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
});

export async function createNoteAction(input: unknown): Promise<ActionState> {
  const parsed = noteCreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const note = await objects.createNote(db, r.scope, {
      ...parsed.data,
      authorUserId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    return { ok: true, id: note.id };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to add note') };
  }
}

const noteUpdateSchema = z.object({
  noteId: uuidSchema,
  entityId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
});

export async function updateNoteAction(input: unknown): Promise<ActionState> {
  const parsed = noteUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const ok = await objects.updateNote(db, r.scope, {
      noteId: parsed.data.noteId,
      body: parsed.data.body,
      actorUserId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    return ok ? { ok: true } : { error: 'Note not found' };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to update note') };
  }
}

export async function deleteNoteAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ noteId: uuidSchema, entityId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const ok = await objects.deleteNote(db, r.scope, {
      noteId: parsed.data.noteId,
      actorUserId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    return ok ? { ok: true } : { error: 'Note not found' };
  } catch (err) {
    return { error: friendlyError(err, 'Failed to delete note') };
  }
}

// ---------- Notifications ----------

export async function markNotificationReadAction(id: string): Promise<ActionState> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  // `markNotificationRead` returns false for both "not found" and "already
  // read" (the SQL is guarded by `readAt IS NULL`). Either way the user's
  // desired state — read — is achieved, so always return ok and let the
  // revalidation refresh whatever stale view triggered the click.
  await objects.markNotificationRead(db, r.scope, parsed.data);
  revalidatePath('/app/inbox');
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<ActionState> {
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  await objects.markAllNotificationsRead(db, r.scope);
  revalidatePath('/app/inbox');
  return { ok: true };
}

// ---------- Suggestion review ----------

const reviewSuggestionSchema = z.object({
  changeId: uuidSchema,
  entityId: uuidSchema,
});

export async function acceptObjectChangeAction(input: unknown): Promise<ActionState> {
  const parsed = reviewSuggestionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const ok = await objects.acceptObjectChange(db, r.scope, parsed.data.changeId, {
      kind: 'user',
      userId: r.userId,
    });
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    revalidatePath('/app/inbox');
    return ok ? { ok: true } : { error: 'Suggestion no longer pending' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to accept' };
  }
}

export async function rejectObjectChangeAction(input: unknown): Promise<ActionState> {
  const parsed = reviewSuggestionSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const ok = await objects.rejectObjectChange(db, r.scope, parsed.data.changeId);
    revalidatePath(`/app/objects/${parsed.data.entityId}`);
    revalidatePath('/app/inbox');
    return ok ? { ok: true } : { error: 'Suggestion no longer pending' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to reject' };
  }
}
