import { boardQualificationRequests, boards, teamMembers, type Db } from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { tagOperatorJob } from '#src/platform-admin/runtime.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Called inside the canonical mutation transaction, never best-effort. */
export async function requestBoardQualification(
  db: Db | DbTx,
  input: {
    teamId: string;
    userId: string;
    entityId: string;
    sourceEventId: string | null;
    requestedBoardId?: string;
    includeRelationshipNeighbors?: boolean;
  },
) {
  // Service principals cannot inherit a member's authority for background inference.
  if (input.userId === '00000000-0000-0000-0000-000000000000') return;
  const [member] = await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
        eq(teamMembers.userId, input.userId),
        isNull(teamMembers.removedAt),
      ),
    )
    .limit(1);
  if (!member) return;
  const [enabled] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.teamId, input.teamId),
        eq(boards.qualificationEnabled, true),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);
  if (!enabled) return;
  const { includeRelationshipNeighbors, ...requestInput } = input;
  const tagged = await tagOperatorJob({
    ...requestInput,
    platformOperatorSessionId: null as string | null,
  });
  const now = new Date();
  if (includeRelationshipNeighbors && input.sourceEventId) {
    // One ordered write keeps every neighbor durable and locks inbox rows consistently.
    await db.execute(sql`
      INSERT INTO board_qualification_requests
        (team_id, user_id, entity_id, source_event_id, platform_operator_session_id, requested_at, available_at)
      SELECT ${input.teamId}::uuid, ${input.userId}::uuid, candidates.id,
        ${input.sourceEventId}::uuid, ${tagged.platformOperatorSessionId}::uuid,
        ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      FROM (
        SELECT ${input.entityId}::uuid AS id
        UNION
        SELECT neighbor.id FROM entity_relationships AS relation
        JOIN entities AS neighbor ON neighbor.id = CASE
        WHEN relation.from_entity_id = ${input.entityId}::uuid THEN relation.to_entity_id
        ELSE relation.from_entity_id END
        WHERE relation.team_id = ${input.teamId}::uuid AND neighbor.team_id = ${input.teamId}::uuid
        AND (relation.from_entity_id = ${input.entityId}::uuid OR relation.to_entity_id = ${input.entityId}::uuid)
        AND neighbor.id <> ${input.entityId}::uuid
        AND neighbor.archived_at IS NULL AND neighbor.merged_into_id IS NULL
      ) AS candidates
      ORDER BY candidates.id
      ON CONFLICT (team_id, user_id, entity_id) DO UPDATE SET
        source_event_id = excluded.source_event_id,
        platform_operator_session_id = excluded.platform_operator_session_id,
        requested_board_id = NULL,
        version = board_qualification_requests.version + 1,
        board_cursor = NULL, requested_at = excluded.requested_at,
        available_at = excluded.available_at, attempts = 0, failure_code = NULL
    `);
    return;
  }
  await db
    .insert(boardQualificationRequests)
    .values({ ...tagged, requestedAt: now, availableAt: now })
    .onConflictDoUpdate({
      target: [
        boardQualificationRequests.teamId,
        boardQualificationRequests.userId,
        boardQualificationRequests.entityId,
      ],
      set: {
        platformOperatorSessionId:
          tagged.platformOperatorSessionId ??
          (input.sourceEventId
            ? null
            : sql`${boardQualificationRequests.platformOperatorSessionId}`),
        requestedBoardId: sql`CASE WHEN ${boardQualificationRequests.requestedBoardId} = ${input.requestedBoardId ?? null} THEN ${input.requestedBoardId ?? null}::uuid ELSE NULL END`,
        sourceEventId: input.sourceEventId ?? sql`${boardQualificationRequests.sourceEventId}`,
        version: sql`${boardQualificationRequests.version} + 1`,
        boardCursor: null,
        requestedAt: now,
        availableAt: now,
        attempts: 0,
        failureCode: null,
      },
    });
}
