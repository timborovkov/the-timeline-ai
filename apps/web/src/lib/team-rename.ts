import { auditLog, teams } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { reportCaughtError } from '@/lib/sentry-report';

/** Display name only — same bounds as Team settings rename. */
export const teamDisplayNameSchema = z.string().trim().min(1).max(80);

export type ApplyTeamRenameResult = { ok: true; changed: boolean } | { error: string };

/**
 * Rename a team the actor administers. Updates `teams.name` only; slug and
 * inbound email stay put so existing addresses and links keep working.
 */
export async function applyTeamRename(params: {
  teamId: string;
  userId: string;
  name: string;
}): Promise<ApplyTeamRenameResult> {
  const parsed = teamDisplayNameSchema.safeParse(params.name);
  if (!parsed.success) return { error: 'Invalid team name' };

  const scope = withTeam(db, params.teamId, params.userId);
  try {
    await scope.requireMembership('admin');
  } catch (err) {
    reportCaughtError(err, { surface: 'server_action', operation: 'rename_team_auth' });
    return { error: 'Only admins can rename a team' };
  }

  try {
    const changed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(teams)
        .set({ name: parsed.data })
        .where(and(eq(teams.id, params.teamId), ne(teams.name, parsed.data)))
        .returning({ id: teams.id });
      if (!updated[0]) return false;
      await tx.insert(auditLog).values({
        teamId: params.teamId,
        actorUserId: params.userId,
        action: 'settings.change',
        targetType: 'team',
        targetId: params.teamId,
        targetVisibility: 'team',
        metadata: { setting: 'team.name' },
      });
      return true;
    });
    return { ok: true, changed };
  } catch (err) {
    reportCaughtError(err, { surface: 'server_action', operation: 'rename_team' });
    return { error: 'Failed to rename team' };
  }
}
