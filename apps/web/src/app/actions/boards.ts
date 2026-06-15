'use server';

import * as boardDomain from '@timeline/shared/boards';
import * as objects from '@timeline/shared/objects';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

const objectTypeSchema = z.enum(objects.OBJECT_TYPES);
const boardTemplateSchema = z.enum(['pipeline', 'task_board', 'catalog', 'custom']);
const laneKindSchema = z.enum(['active', 'done', 'terminal', 'lost', 'blocked']);

const laneSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  kind: laneKindSchema.nullable().optional(),
});

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(1000).optional(),
  templateKind: boardTemplateSchema,
  recommendedObjectTypes: z.array(objectTypeSchema).max(8).optional(),
  lanes: z.array(laneSchema).max(16).optional(),
});

const renameBoardSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
});

const updateBoardSettingsSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(1000),
  lanes: z.array(laneSchema).min(1).max(16),
});

const boardItemPatchSchema = z.object({
  id: uuidSchema,
  laneId: uuidSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
  responsibleUserId: uuidSchema.nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  nextStep: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

const addExistingSchema = z.object({
  boardId: uuidSchema,
  entityId: uuidSchema,
  laneId: uuidSchema.nullable().optional(),
});

const quickCreateSchema = z.object({
  boardId: uuidSchema,
  type: objectTypeSchema,
  canonicalName: z.string().trim().min(1).max(200),
  laneId: uuidSchema.nullable().optional(),
});

function revalidateBoardSurfaces(boardId?: string, entityId?: string): void {
  const paths = ['/app', '/app/boards', '/app/work'];
  if (boardId) paths.push(`/app/boards/${boardId}`);
  if (entityId) paths.push(`/app/objects/${entityId}`);

  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (err) {
      reportCaughtError(err, {
        surface: 'server_action',
        operation: 'revalidate_board_surfaces',
      });
    }
  }
}

function friendlyError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === '23505') return 'That item is already on this board.';
    if (code === '23503') return 'Linked record no longer exists.';
  }
  reportCaughtError(err, { surface: 'server_action', operation: fallback });
  return err instanceof Error ? err.message : 'Board action failed';
}

function recommendedTypesFor(templateKind: boardDomain.BoardTemplateKind): objects.ObjectType[] {
  if (templateKind === 'pipeline') return ['company', 'deal', 'project'];
  if (templateKind === 'task_board') return ['task', 'follow_up'];
  if (templateKind === 'catalog') return ['project', 'document', 'vendor', 'other'];
  return [];
}

export async function createBoardAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('create_board', async () => {
    const parsed = createBoardSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const templateKind = parsed.data.templateKind;
      const board = await r.scope.boards.createBoard({
        name: parsed.data.name,
        purpose: parsed.data.purpose ?? '',
        templateKind,
        recommendedObjectTypes:
          parsed.data.recommendedObjectTypes ?? recommendedTypesFor(templateKind),
        lanes: parsed.data.lanes ?? boardDomain.defaultBoardLanes(templateKind),
      });
      revalidateBoardSurfaces(board.id);
      return { ok: true, id: board.id };
    } catch (err) {
      return { error: friendlyError(err, 'create_board') };
    }
  });
}

export async function deleteBoardAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('archive_board', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.boards.archiveBoard(parsed.data.id);
      revalidateBoardSurfaces(parsed.data.id);
      return ok ? { ok: true } : { error: 'Board not found' };
    } catch (err) {
      return { error: friendlyError(err, 'archive_board') };
    }
  });
}

export async function renameBoardAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('rename_board', async () => {
    const parsed = renameBoardSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.boards.renameBoard(parsed.data);
      if (!ok) return { error: 'Board not found' };
      revalidateBoardSurfaces(parsed.data.id);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'rename_board') };
    }
  });
}

export async function updateBoardSettingsAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('update_board_settings', async () => {
    const parsed = updateBoardSettingsSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const ok = await r.scope.boards.updateBoardSettings(parsed.data);
      if (!ok) return { error: 'Board not found' };
      revalidateBoardSurfaces(parsed.data.id);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'update_board_settings') };
    }
  });
}

export async function addBoardItemAction(
  input: unknown,
): Promise<ActionState & { item?: boardDomain.BoardItemRow }> {
  return runSentryServerAction('add_board_item', async () => {
    const parsed = addExistingSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const item = await r.scope.boards.addBoardItem(parsed.data.boardId, {
        entityId: parsed.data.entityId,
        laneId: parsed.data.laneId ?? null,
        actor: { kind: 'user', userId: r.userId },
      });
      revalidateBoardSurfaces(parsed.data.boardId, item.entityId);
      return { ok: true, id: item.id, item };
    } catch (err) {
      return { error: friendlyError(err, 'add_board_item') };
    }
  });
}

export async function quickCreateBoardItemAction(
  input: unknown,
): Promise<ActionState & { item?: boardDomain.BoardItemRow }> {
  return runSentryServerAction('quick_create_board_item', async () => {
    const parsed = quickCreateSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const item = await r.scope.boards.createObjectAndAddBoardItem(
        parsed.data.boardId,
        {
          type: parsed.data.type,
          canonicalName: parsed.data.canonicalName,
        },
        {
          laneId: parsed.data.laneId ?? null,
          actor: { kind: 'user', userId: r.userId },
        },
      );
      revalidateBoardSurfaces(parsed.data.boardId, item.entityId);
      return { ok: true, id: item.id, item };
    } catch (err) {
      return { error: friendlyError(err, 'quick_create_board_item') };
    }
  });
}

export async function updateBoardItemAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('update_board_item', async () => {
    const parsed = boardItemPatchSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    const { id, dueAt, ...rest } = parsed.data;
    try {
      const item = await r.scope.boards.updateBoardItem(
        id,
        {
          ...rest,
          ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        },
        { kind: 'user', userId: r.userId },
      );
      if (!item) return { error: 'Board item not found' };
      revalidateBoardSurfaces(item.boardId, item.entityId);
      return { ok: true, id };
    } catch (err) {
      return { error: friendlyError(err, 'update_board_item') };
    }
  });
}

export async function removeBoardItemAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('remove_board_item', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid input' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      const item = await r.scope.boards.removeBoardItem(parsed.data.id, {
        kind: 'user',
        userId: r.userId,
      });
      revalidateBoardSurfaces(item?.boardId, item?.entityId);
      return item ? { ok: true } : { error: 'Board item not found' };
    } catch (err) {
      return { error: friendlyError(err, 'remove_board_item') };
    }
  });
}

export async function pinBoardAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('pin_board', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.boards.pinBoard(parsed.data.id);
      revalidateBoardSurfaces(parsed.data.id);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'pin_board') };
    }
  });
}

export async function unpinBoardAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('unpin_board', async () => {
    const parsed = z.object({ id: uuidSchema }).safeParse(input);
    if (!parsed.success) return { error: 'Invalid id' };
    const r = await resolveScope();
    if (!r.ok) return { error: r.error };
    try {
      await r.scope.boards.unpinBoard(parsed.data.id);
      revalidateBoardSurfaces(parsed.data.id);
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'unpin_board') };
    }
  });
}
