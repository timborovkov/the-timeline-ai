import { UUID_RE } from '@timeline/shared/identifiers';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

type ResolvedScope =
  | { ok: false; error: string }
  | { ok: true; scope: ReturnType<typeof withTeam>; teamId: string; userId: string };

export async function resolveScope(): Promise<ResolvedScope> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { ok: false, error: 'No active team' };
  return {
    ok: true,
    scope: withTeam(db, active.teamId, session.user.id),
    teamId: active.teamId,
    userId: session.user.id,
  };
}
