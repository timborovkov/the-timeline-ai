'use server';

import { objects, withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

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
