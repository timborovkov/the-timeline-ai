import { boardQualificationRequests, teamMembers, type Db } from '@timeline/db';
import { activeWorkspaceCondition } from '@timeline/shared/platform-admin/runtime';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';

/** One due request per active workspace keeps bulk scans from starving other teams. */
export function discoverBoardQualificationRequests(db: Db, now = new Date()) {
  const dueByTeam = db
    .selectDistinctOn([boardQualificationRequests.teamId], {
      id: boardQualificationRequests.id,
      teamId: boardQualificationRequests.teamId,
      userId: boardQualificationRequests.userId,
      version: boardQualificationRequests.version,
      platformOperatorSessionId: boardQualificationRequests.platformOperatorSessionId,
      availableAt: boardQualificationRequests.availableAt,
    })
    .from(boardQualificationRequests)
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, boardQualificationRequests.teamId),
        eq(teamMembers.userId, boardQualificationRequests.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .where(
      and(
        lte(boardQualificationRequests.availableAt, now),
        activeWorkspaceCondition(boardQualificationRequests.teamId),
      ),
    )
    .orderBy(
      asc(boardQualificationRequests.teamId),
      asc(boardQualificationRequests.availableAt),
      asc(boardQualificationRequests.id),
    )
    .as('due_board_teams');
  return db
    .select()
    .from(dueByTeam)
    .orderBy(asc(dueByTeam.availableAt), asc(dueByTeam.teamId))
    .limit(10);
}
