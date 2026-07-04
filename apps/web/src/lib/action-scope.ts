import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Shared auth + active-team resolution for server actions.
 *
 * Every mutating action in this app needs the same prologue: load the
 * session, resolve the user's active team, build a `withTeam` scope, and
 * surface a `{ ok: false }` discriminant when any of those steps fails.
 * Keeping that logic in one place means a change to auth shape, logging,
 * or the scope helper only touches one file.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidSchema = z.string().regex(UUID_RE, 'Invalid id');

export interface ActionState {
  error?: string;
  failedItemIds?: string[];
  ok?: boolean;
  id?: string;
  message?: string;
}

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
