'use server';

import { withTeam } from '@timeline/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const createTextSchema = z.object({
  text: z.string().trim().min(1, 'Write something').max(20000),
  visibility: z.enum(['team', 'private']).default('team'),
});

export interface CreateEventState {
  error?: string;
  ok?: boolean;
  // Monotonic id that changes on every successful submit so the client can
  // distinguish two consecutive successes (otherwise `ok: true` looks identical
  // to React's dep-array check and effects won't re-fire).
  at?: number;
}

export async function createTextEventAction(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  // The form sends both a hidden 'team' default and a checked 'private' when
  // the checkbox is on. Take the last value so the checkbox overrides the
  // default when present, regardless of whether `get` returns the first.
  const visibilityValues = formData.getAll('visibility');
  const visibility = visibilityValues[visibilityValues.length - 1] ?? 'team';

  const parsed = createTextSchema.safeParse({
    text: formData.get('text'),
    visibility,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  await scope.createEvent({
    authorUserId: session.user.id,
    source: 'web',
    contentText: parsed.data.text,
    visibility: parsed.data.visibility,
  });

  revalidatePath('/app/timeline');
  return { ok: true, at: Date.now() };
}
