import { teams, platformAdminAudit, platformAdminRetentionHolds, type Db } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  requirePlatformActor,
  setPlatformSuspension,
  type PlatformActor,
} from '#src/platform-admin/index.js';
import { deletionConfirmation } from '#src/team-lifecycle/scope.js';

export async function beginTeamDeletion(db: Db, actor: PlatformActor, raw: unknown) {
  const input = deletionConfirmation.parse(raw);
  await requirePlatformActor(db, actor);
  await db.transaction(async (tx) => {
    await requirePlatformActor(tx as unknown as Db, actor);
    const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId)).for('update');
    if (team?.name !== input.confirmation) throw new Error('Enter the exact team name');
    if (team.deletedAt || team.deletionStartedAt) return;
    // The same team lock protects both suspension and irreversible acceptance.
    await setPlatformSuspension(
      tx as unknown as Db,
      actor,
      'team',
      input.teamId,
      true,
      input.reason,
    );
    const [disabled] = await tx.select().from(teams).where(eq(teams.id, input.teamId));
    if (!disabled?.disabledAt) throw new Error('Deletion requires a disabled team');
    // Holds preserve platform security evidence, not the entire workspace.
    await tx
      .update(teams)
      .set({
        deletionStartedAt: new Date(),
        lifecycleWork: {
          ...disabled.lifecycleWork,
          deletionActorUserId: actor.userId,
          stage: 'inventory',
          attempts: 0,
          followups: ['backups', 'processors', 'retained_records'].map((category) => ({
            category: category as 'backups' | 'processors' | 'retained_records',
            status: 'pending' as const,
            reference: '',
          })),
          externalFollowup:
            'Backup expiry and applicable processor deletion require operator verification. Financial/security records follow their documented retention and holds.',
        },
      })
      .where(eq(teams.id, input.teamId));
    await tx.insert(platformAdminAudit).values({
      actorUserId: actor.userId,
      teamId: input.teamId,
      targetId: input.teamId,
      action: 'team.deletion_started',
      reason: input.reason,
    });
  });
}

export async function retryTeamLifecycle(db: Db, actor: PlatformActor, teamId: string) {
  await requirePlatformActor(db, actor);
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
    if (!team) throw new Error('Team not found');
    const work = { ...team.lifecycleWork };
    delete work.error;
    if (work.stage !== 'verify') delete work.retryAt;
    await tx.update(teams).set({ lifecycleWork: work }).where(eq(teams.id, teamId));
    await tx
      .insert(platformAdminAudit)
      .values({ actorUserId: actor.userId, teamId, action: 'team.cleanup_retry' });
  });
}

export async function listTeamRetentionHolds(db: Db, actor: PlatformActor, teamId: string) {
  await requirePlatformActor(db, actor);
  return db
    .select()
    .from(platformAdminRetentionHolds)
    .where(
      and(
        eq(platformAdminRetentionHolds.teamId, teamId),
        isNull(platformAdminRetentionHolds.releasedAt),
      ),
    );
}

export async function recordTeamDeletionFollowup(db: Db, actor: PlatformActor, raw: unknown) {
  const input = z
    .object({
      teamId: z.uuid(),
      category: z.enum(['backups', 'processors', 'retained_records']),
      status: z.enum(['pending', 'retained', 'complete']),
      reference: z.string().trim().min(3).max(1000),
      expiresAt: z.string().optional(),
    })
    .parse(raw);
  if (
    input.status === 'retained' &&
    (!input.expiresAt || !Number.isFinite(Date.parse(input.expiresAt)))
  )
    throw new Error('Retained data requires an expiry or review date');
  await db.transaction(async (tx) => {
    await requirePlatformActor(tx as unknown as Db, actor);
    const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId)).for('update');
    if (!team?.deletionStartedAt) throw new Error('No deletion in progress');
    const { teamId } = input;
    const followup = {
      category: input.category,
      status: input.status,
      reference: input.reference,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    await tx
      .update(teams)
      .set({
        lifecycleWork: {
          ...team.lifecycleWork,
          followups: [
            ...(team.lifecycleWork.followups ?? []).filter(
              (item) => item.category !== input.category,
            ),
            followup,
          ],
        },
      })
      .where(eq(teams.id, teamId));
    await tx.insert(platformAdminAudit).values({
      actorUserId: actor.userId,
      teamId,
      action: 'team.deletion_followup',
      metadata: { category: input.category, status: input.status },
      reason: input.reference,
    });
  });
}
