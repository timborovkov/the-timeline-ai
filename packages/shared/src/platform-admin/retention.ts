import {
  platformAdminAudit,
  platformAdminRetentionHolds,
  platformImpersonationSessions,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  requirePlatformActor,
  recordPlatformAudit,
  type PlatformActor,
} from '#src/platform-admin/index.js';

const BATCH_SIZE = 500;

/** Internal maintenance only: no cookie, team membership, or customer-content access. */
export async function prunePlatformAdminRecords(db: Db) {
  return db.transaction(async (tx) => {
    // Serialize retention with hold creation/release. A hold cannot appear between
    // the eligibility query and deletion. The DB trigger independently protects audit rows.
    await tx.execute(sql`LOCK TABLE platform_admin_retention_holds IN SHARE ROW EXCLUSIVE MODE`);
    const sessions = await tx
      .delete(platformImpersonationSessions)
      .where(
        inArray(
          platformImpersonationSessions.id,
          tx
            .select({ id: platformImpersonationSessions.id })
            .from(platformImpersonationSessions)
            .where(
              sql`
        LEAST(${platformImpersonationSessions.expiresAt}, COALESCE(${platformImpersonationSessions.endedAt}, ${platformImpersonationSessions.expiresAt})) < now() - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM ${platformAdminRetentionHolds} h WHERE h.released_at IS NULL AND
          (h.team_id = ${platformImpersonationSessions.teamId} OR h.user_id = ${platformImpersonationSessions.actorUserId} OR h.user_id = ${platformImpersonationSessions.effectiveUserId}))
      `,
            )
            .orderBy(platformImpersonationSessions.expiresAt, platformImpersonationSessions.id)
            .limit(BATCH_SIZE),
        ),
      )
      .returning({ id: platformImpersonationSessions.id });
    const audit = await tx
      .delete(platformAdminAudit)
      .where(
        inArray(
          platformAdminAudit.id,
          tx
            .select({ id: platformAdminAudit.id })
            .from(platformAdminAudit)
            .where(
              sql`
        ${platformAdminAudit.createdAt} < now() - interval '12 months'
        AND NOT EXISTS (SELECT 1 FROM ${platformAdminRetentionHolds} h WHERE h.released_at IS NULL AND
          (h.team_id = ${platformAdminAudit.teamId} OR h.team_id = ${platformAdminAudit.targetId} OR
           h.user_id = ${platformAdminAudit.actorUserId} OR h.user_id = ${platformAdminAudit.effectiveUserId} OR h.user_id = ${platformAdminAudit.targetId}))
      `,
            )
            .orderBy(platformAdminAudit.createdAt, platformAdminAudit.id)
            .limit(BATCH_SIZE),
        ),
      )
      .returning({ id: platformAdminAudit.id });
    const holds = await tx
      .delete(platformAdminRetentionHolds)
      .where(
        inArray(
          platformAdminRetentionHolds.id,
          tx
            .select({ id: platformAdminRetentionHolds.id })
            .from(platformAdminRetentionHolds)
            .where(sql`${platformAdminRetentionHolds.releasedAt} < now() - interval '12 months'`)
            .orderBy(platformAdminRetentionHolds.releasedAt, platformAdminRetentionHolds.id)
            .limit(BATCH_SIZE),
        ),
      )
      .returning({ id: platformAdminRetentionHolds.id });
    return {
      sessionsDeleted: sessions.length,
      auditRecordsDeleted: audit.length,
      releasedHoldsDeleted: holds.length,
    };
  });
}

export async function placePlatformRetentionHold(
  db: Db,
  actor: PlatformActor,
  input: {
    kind: 'user' | 'team';
    id: string;
    reason: string;
    reference: string;
  },
) {
  const kind = z.enum(['user', 'team']).parse(input.kind);
  const id = z.uuid().parse(input.id);
  const reason = z.string().trim().min(3).max(1000).parse(input.reason);
  const reference = z.string().trim().min(1).max(200).parse(input.reference);
  return db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    const [hold] = await tx
      .insert(platformAdminRetentionHolds)
      .values({
        [kind === 'team' ? 'teamId' : 'userId']: id,
        actorUserId: actor.userId,
        reason,
        reference,
      })
      .returning({ id: platformAdminRetentionHolds.id });
    if (!hold) throw new Error('Could not place retention hold');
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      action: 'retention.hold.place',
      targetId: id,
      teamId: kind === 'team' ? id : null,
      reason,
      metadata: { holdId: hold.id, reference, kind },
    });
    return hold;
  });
}

export async function releasePlatformRetentionHold(
  db: Db,
  actor: PlatformActor,
  id: string,
  reason: string,
) {
  z.uuid().parse(id);
  reason = z.string().trim().min(3).max(1000).parse(reason);
  await db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    const [hold] = await tx
      .update(platformAdminRetentionHolds)
      .set({ releasedAt: new Date() })
      .where(
        and(eq(platformAdminRetentionHolds.id, id), isNull(platformAdminRetentionHolds.releasedAt)),
      )
      .returning();
    if (!hold) throw new Error('Active retention hold not found');
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      action: 'retention.hold.release',
      targetId: hold.teamId ?? hold.userId,
      teamId: hold.teamId,
      reason,
      metadata: { holdId: hold.id, reference: hold.reference },
    });
  });
}
