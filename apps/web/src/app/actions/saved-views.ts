'use server';

import { withTeam } from '@timeline/shared/team-scope';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const collection = z.enum(['approvals', 'tasks', 'objects', 'boards']);
const title = z.string().trim().min(1).max(100);

async function activeScope() {
  const session = await auth();
  if (!session?.user) return null;
  const { active } = await resolveActiveTeam(session.user.id);
  return active ? withTeam(db, active.teamId, session.user.id) : null;
}

export async function createSavedWorkView(input: unknown) {
  const parsed = z
    .object({
      collection,
      title,
      targetId: z.uuid().nullable(),
      filters: z.record(z.string(), z.string().max(500)),
    })
    .safeParse(input);
  const scope = await activeScope();
  if (!parsed.success || !scope)
    return { ok: false, error: 'Choose a name and sign in to your workspace.' };
  const { filters } = parsed.data;
  if (
    parsed.data.collection === 'approvals' &&
    [filters.project, filters.boardId].some((value) => value && !z.uuid().safeParse(value).success)
  ) {
    return { ok: false, error: 'The current approval filter is unavailable.' };
  }
  try {
    const created = await scope.savedViews.create(parsed.data);
    if (!created)
      return {
        ok: false,
        error: 'This view is unavailable or you have reached the saved view limit.',
      };
    revalidatePath('/app/work/views');
    return { ok: true, id: created };
  } catch {
    return { ok: false, error: 'Couldn’t save this view.' };
  }
}

export async function manageSavedWorkView(id: string, input: unknown) {
  const parsed = z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('rename'), title }),
      z.object({ type: z.literal('notify'), enabled: z.boolean() }),
      z.object({ type: z.literal('delete') }),
    ])
    .safeParse(input);
  const scope = await activeScope();
  if (
    !parsed.success ||
    !scope ||
    !z.uuid().safeParse(id).success ||
    !(await scope.savedViews.manage(id, parsed.data))
  ) {
    return {
      ok: false,
      error: 'This view is unavailable or has too many matches for notifications.',
    };
  }
  revalidatePath('/app/work/views');
  return { ok: true };
}
