'use server';

import { pinTargetKindSchema } from '@timeline/shared/pins';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { publicActionError } from '@/lib/public-error';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

const targetSchema = z.object({
  kind: pinTargetKindSchema,
  key: z.string().trim().min(1).max(500),
});

const moveSchema = z
  .object({
    pinId: uuidSchema,
    beforePinId: uuidSchema.optional(),
    afterPinId: uuidSchema.optional(),
    edge: z.enum(['top', 'bottom']).optional(),
  })
  .refine(
    (input) =>
      Boolean(input.edge) !== Boolean(input.beforePinId ?? input.afterPinId) &&
      !(input.beforePinId && input.afterPinId && input.beforePinId === input.afterPinId),
    { message: 'Choose one valid pin position' },
  );

function revalidatePinSurfaces(target?: z.infer<typeof targetSchema>): void {
  const paths = ['/app', '/app/work'];
  if (target?.kind === 'object') paths.push(`/app/objects/${target.key}`, '/app/tasks');
  if (target?.kind === 'board') paths.push(`/app/boards/${target.key}`, '/app/boards');
  if (target?.kind === 'document') paths.push(`/app/documents/${target.key}`, '/app/documents');
  if (target?.kind === 'meeting') paths.push(`/app/meetings/${target.key}`, '/app/meetings');
  if (target?.kind === 'saved_meeting') paths.push('/app/meetings');
  if (target?.kind === 'calendar_event') paths.push('/app/calendar');
  if (target?.kind === 'timeline_moment') paths.push('/app/timeline');
  for (const path of new Set(paths)) {
    try {
      revalidatePath(path);
    } catch (error) {
      reportCaughtError(error, { surface: 'server_action', operation: 'revalidate_pin_surfaces' });
    }
  }
}

export async function pinTargetAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('pin_target', async () => {
    const parsed = targetSchema.safeParse(input);
    if (!parsed.success) return { error: 'Invalid pinned item' };
    const resolved = await resolveScope();
    if (!resolved.ok) return { error: resolved.error };
    try {
      const item = await resolved.scope.pins.pin(parsed.data);
      revalidatePinSurfaces(parsed.data);
      return { ok: true, id: item.pinId, message: `Pinned ${item.title}` };
    } catch (error) {
      return {
        error: publicActionError(error, {
          operation: 'pin_target',
          fallback: 'That item is not available to pin.',
        }),
      };
    }
  });
}

export async function unpinTargetAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('unpin_target', async () => {
    const parsed = targetSchema.safeParse(input);
    if (!parsed.success) return { error: 'Invalid pinned item' };
    const resolved = await resolveScope();
    if (!resolved.ok) return { error: resolved.error };
    try {
      await resolved.scope.pins.unpin(parsed.data);
      revalidatePinSurfaces(parsed.data);
      return { ok: true, message: 'Item unpinned' };
    } catch (error) {
      return {
        error: publicActionError(error, {
          operation: 'unpin_target',
          fallback: 'Could not unpin that item.',
        }),
      };
    }
  });
}

export async function movePinAction(input: unknown): Promise<ActionState> {
  return runSentryServerAction('move_pin', async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid position' };
    const resolved = await resolveScope();
    if (!resolved.ok) return { error: resolved.error };
    try {
      const moved = await resolved.scope.pins.move(parsed.data);
      if (!moved) return { error: 'Pinned item or position no longer exists.' };
      revalidatePinSurfaces();
      return { ok: true };
    } catch (error) {
      return {
        error: publicActionError(error, {
          operation: 'move_pin',
          fallback: 'Could not move that pinned item.',
        }),
      };
    }
  });
}
