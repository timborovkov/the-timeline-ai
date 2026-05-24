'use server';

import { objects } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { type ActionState, resolveScope, uuidSchema } from '@/lib/action-scope';
import { db } from '@/lib/db';

const objectTypeSchema = z.enum(objects.OBJECT_TYPES);

// Mirrors ObjectListFilter at packages/shared/src/objects/index.ts:60. Kept
// loose (everything optional) so callers can save partial filters.
const filterSchema = z
  .object({
    type: z.union([objectTypeSchema, z.array(objectTypeSchema)]).optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    stage: z.union([z.string(), z.array(z.string())]).optional(),
    ownerUserId: uuidSchema.nullable().optional(),
    assigneeUserId: uuidSchema.nullable().optional(),
    archived: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const boardKindSchema = z.enum(['kanban', 'table', 'list']);

const saveBoardSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  kind: boardKindSchema,
  filter: filterSchema,
  groupBy: z.string().trim().min(1).max(40).nullable().optional(),
  isShared: z.boolean().optional(),
});

export async function saveBoardAction(input: unknown): Promise<ActionState> {
  const parsed = saveBoardSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  try {
    const row = await objects.saveBoardView(db, r.scope, {
      id: parsed.data.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      filter: parsed.data.filter,
      groupBy: parsed.data.groupBy ?? null,
      isShared: parsed.data.isShared,
    });
    revalidatePath('/app/boards');
    if (parsed.data.id) revalidatePath(`/app/boards/${parsed.data.id}`);
    return { ok: true, id: row.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to save board' };
  }
}

export async function deleteBoardAction(input: unknown): Promise<ActionState> {
  const parsed = z.object({ id: uuidSchema }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid id' };
  const r = await resolveScope();
  if (!r.ok) return { error: r.error };
  const ok = await objects.deleteBoardView(db, r.scope, parsed.data.id);
  revalidatePath('/app/boards');
  return ok ? { ok: true } : { error: 'Board not found' };
}
