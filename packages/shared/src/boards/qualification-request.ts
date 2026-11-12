import { boardQualificationRequests, boards, entities, teamMembers, type Db } from '@timeline/db';
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
    pendingEntityIds?: string[];
    requestedAt?: Date;
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
  const tagged = await tagOperatorJob({
    ...input,
    platformOperatorSessionId: null as string | null,
  });
  const now = new Date();
  await db.transaction(async (tx) => {
    // Match the entity-before-inbox order used by canonical mutations, including scan writes.
    await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.teamId, input.teamId), eq(entities.id, input.entityId)))
      .for('key share');
    await tx
      .insert(boardQualificationRequests)
      .values({ ...tagged, requestedAt: input.requestedAt ?? now, availableAt: now })
      .onConflictDoUpdate({
        target: [
          boardQualificationRequests.teamId,
          boardQualificationRequests.userId,
          boardQualificationRequests.entityId,
        ],
        set: {
          pendingEntityIds: sql`ARRAY(SELECT DISTINCT unnest(${boardQualificationRequests.pendingEntityIds} || excluded.pending_entity_ids))`,
          includeRelationshipNeighbors: sql`${boardQualificationRequests.includeRelationshipNeighbors} OR ${input.includeRelationshipNeighbors ?? false}`,
          relationshipCursor: input.includeRelationshipNeighbors
            ? null
            : sql`${boardQualificationRequests.relationshipCursor}`,
          platformOperatorSessionId: sql`CASE WHEN ${boardQualificationRequests.requestedAt} > excluded.requested_at THEN ${boardQualificationRequests.platformOperatorSessionId} ELSE COALESCE(excluded.platform_operator_session_id, CASE WHEN excluded.source_event_id IS NULL THEN ${boardQualificationRequests.platformOperatorSessionId} ELSE NULL END) END`,
          requestedBoardId: sql`CASE WHEN ${boardQualificationRequests.requestedBoardId} = ${input.requestedBoardId ?? null} THEN ${input.requestedBoardId ?? null}::uuid ELSE NULL END`,
          sourceEventId: sql`CASE WHEN ${boardQualificationRequests.requestedAt} > excluded.requested_at THEN ${boardQualificationRequests.sourceEventId} ELSE COALESCE(excluded.source_event_id, ${boardQualificationRequests.sourceEventId}) END`,
          version: sql`${boardQualificationRequests.version} + 1`,
          boardCursor: null,
          requestedAt: sql`GREATEST(${boardQualificationRequests.requestedAt}, excluded.requested_at)`,
          availableAt: now,
          attempts: 0,
          failureCode: null,
        },
      });
  });
}
