'use server';

import * as boardDomain from '@timeline/shared/boards';
import * as objects from '@timeline/shared/objects';
import { z } from 'zod';

import type { ActionState } from '@/lib/action-result';

import { resolveScope, uuidSchema } from '@/lib/action-scope';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { publicActionError } from '@/lib/public-error';
import { refreshMutation } from '@/lib/refresh-mutation';
import { runSentryServerAction } from '@/lib/sentry-action';

const objectTypeSchema = z.enum(objects.OBJECT_TYPES);
const boardTemplateSchema = z.enum(['pipeline', 'task_board', 'catalog', 'custom']);
const laneKindSchema = z.enum(['active', 'done', 'terminal', 'lost', 'blocked']);

const qualificationFields = {
  qualificationEnabled: z.boolean().optional(),
  qualificationInstructions: z.string().trim().max(2000).optional(),
  strictObjectTypes: z.boolean().optional(),
  recommendedObjectTypes: z.array(objectTypeSchema).max(32).optional(),
};

const laneSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  kind: laneKindSchema.nullable().optional(),
});

const createBoardSchema = z.object({
  ...qualificationFields,
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(1000).optional(),
  templateKind: boardTemplateSchema,
  lanes: z.array(laneSchema).max(16).optional(),
});

const renameBoardSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
});

const updateBoardSettingsSchema = z.object({
  ...qualificationFields,
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

function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? 'Invalid board settings';
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === '23505') return 'That item is already on this board.';
    if (code === '23503') return 'Linked record no longer exists.';
  }
  return publicActionError(err, {
    operation: fallback,
    fallback: 'Board action failed.',
    expected: {
      'This object type is not allowed on this board.': {
        message: 'This object type is not allowed on this board.',
      },
      'Board suggestions are not enabled.': {
        message: 'Enable suggestions and save the board criteria first.',
      },
    },
  });
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
        qualificationEnabled: parsed.data.qualificationEnabled,
        qualificationInstructions: parsed.data.qualificationInstructions,
        strictObjectTypes: parsed.data.strictObjectTypes,
        recommendedObjectTypes: parsed.data.strictObjectTypes
          ? (parsed.data.recommendedObjectTypes ?? [])
          : parsed.data.recommendedObjectTypes?.length
            ? parsed.data.recommendedObjectTypes
            : boardDomain.defaultBoardRecommendedTypes(templateKind),
        lanes: parsed.data.lanes ?? boardDomain.defaultBoardLanes(templateKind),
      });
      trackProductEventBestEffort(
        { kind: 'user', userId: r.userId, teamId: r.teamId },
        'board_action_completed',
        { action: 'create' },
      );
      refreshMutation({ kind: 'board-changed', boardId: board.id }, 'revalidate_board_surfaces');
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
      if (ok) {
        trackProductEventBestEffort(
          { kind: 'user', userId: r.userId, teamId: r.teamId },
          'board_action_completed',
          { action: 'delete' },
        );
      }
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.id },
        'revalidate_board_surfaces',
      );
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
      trackProductEventBestEffort(
        { kind: 'user', userId: r.userId, teamId: r.teamId },
        'board_action_completed',
        { action: 'update' },
      );
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.id },
        'revalidate_board_surfaces',
      );
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
      trackProductEventBestEffort(
        { kind: 'user', userId: r.userId, teamId: r.teamId },
        'board_action_completed',
        { action: 'update' },
      );
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.id },
        'revalidate_board_surfaces',
      );
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
      trackProductEventBestEffort(
        { kind: 'user', userId: r.userId, teamId: r.teamId },
        'board_action_completed',
        { action: 'item_add' },
      );
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.boardId, entityId: item.entityId },
        'revalidate_board_surfaces',
      );
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
      trackProductEventBestEffort(
        { kind: 'user', userId: r.userId, teamId: r.teamId },
        'board_action_completed',
        { action: 'item_add' },
      );
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.boardId, entityId: item.entityId },
        'revalidate_board_surfaces',
      );
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
      const result = await r.scope.boards.updateBoardItem(
        id,
        {
          ...rest,
          ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
        },
        { kind: 'user', userId: r.userId },
      );
      if (!result) return { error: 'Board item not found' };
      if (result.changed) {
        trackProductEventBestEffort(
          { kind: 'user', userId: r.userId, teamId: r.teamId },
          'board_action_completed',
          { action: 'item_update' },
        );
        refreshMutation(
          { kind: 'board-changed', boardId: result.item.boardId, entityId: result.item.entityId },
          'revalidate_board_surfaces',
        );
      }
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
      if (item) {
        trackProductEventBestEffort(
          { kind: 'user', userId: r.userId, teamId: r.teamId },
          'board_action_completed',
          { action: 'item_remove' },
        );
      }
      refreshMutation(
        { kind: 'board-changed', boardId: item?.boardId, entityId: item?.entityId },
        'revalidate_board_surfaces',
      );
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
      await r.scope.pins.pin({ kind: 'board', key: parsed.data.id });
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.id },
        'revalidate_board_surfaces',
      );
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
      await r.scope.pins.unpin({ kind: 'board', key: parsed.data.id });
      refreshMutation(
        { kind: 'board-changed', boardId: parsed.data.id },
        'revalidate_board_surfaces',
      );
      return { ok: true };
    } catch (err) {
      return { error: friendlyError(err, 'unpin_board') };
    }
  });
}

export async function previewBoardMatchesAction(input: unknown) {
  const parsed = z.object({ boardId: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid board' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const objects = await r.scope.objects.listObjects({ limit: 3, archived: false });
    const results = await Promise.allSettled(
      objects.map(async (object) => ({
        id: object.id,
        name: object.canonicalName,
        ...(await r.scope.boardQualification.preview(parsed.data.boardId, object.id)),
      })),
    );
    const matches = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    if (results.some((result) => result.status === 'rejected'))
      return {
        matches,
        warning: 'Some objects could not be checked. Preview is incomplete; try again.',
      };
    return { matches };
  } catch (err) {
    return { error: friendlyError(err, 'preview_board_matches') };
  }
}

export async function scanBoardMatchesAction(input: unknown) {
  const parsed = z.object({ boardId: uuidSchema, afterId: uuidSchema.optional() }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid board' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    return await r.scope.boardQualification.scan(parsed.data.boardId, parsed.data.afterId);
  } catch (err) {
    return { error: friendlyError(err, 'scan_board_matches') };
  }
}
