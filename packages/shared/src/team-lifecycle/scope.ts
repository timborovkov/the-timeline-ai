import { randomUUID } from 'node:crypto';

import { teams, teamMembers, teamBillingAccounts, platformAdminAudit, type Db } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { operatorContext } from '#src/platform-admin/runtime.js';
import { createLifecycleMaintenance } from '#src/team-lifecycle/maintenance.js';
import { purgeTeamRows, verifyTeamRows } from '#src/team-lifecycle/purge.js';

/** Lifecycle mutations have a separate capability from reading private workspace content. */
export function createTeamLifecycleScope(db: Db, teamId: string, userId: string, system = false) {
  async function authorizeMaintenance() {
    if (!system || (await operatorContext()))
      throw new Error('Lifecycle maintenance requires an internal system scope');
  }
  return {
    ...createLifecycleMaintenance(db, teamId, authorizeMaintenance),
    async requestDeletion(confirmation: string) {
      if (await operatorContext())
        throw new Error('Use your own owner account to request deletion');
      await db.transaction(async (tx) => {
        const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for('update');
        const [member] = await tx
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, teamId),
              eq(teamMembers.userId, userId),
              isNull(teamMembers.removedAt),
            ),
          )
          .for('update');
        if (!team || member?.role !== 'owner')
          throw new Error('Only team owners can request deletion');
        if (confirmation !== team.name) throw new Error('Enter the exact team name');
        if (team.deletionStartedAt) throw new Error('Permanent deletion has already started');
        if (team.deletionRequestedAt) return;
        const [account] = await tx
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, teamId))
          .for('update');
        const now = new Date();
        await tx
          .update(teams)
          .set({
            disabledPeriods: team.disabledAt
              ? team.disabledPeriods
              : [...team.disabledPeriods, { start: now.toISOString() }],
            disabledAt: team.disabledAt ?? now,
            disabledByUserId: userId,
            disabledReason: 'Owner requested permanent deletion',
            suspensionPreviousState:
              team.suspensionPreviousState ?? account?.securityState ?? 'normal',
            deletionRequestedAt: now,
            deletionRequestedByUserId: userId,
            lifecycleWork: {
              ...team.lifecycleWork,
              requestId: randomUUID(),
              notificationPending: true,
              billingPending: true,
            },
          })
          .where(eq(teams.id, teamId));
        await tx
          .insert(teamBillingAccounts)
          .values({ teamId, securityState: 'suspended' })
          .onConflictDoUpdate({
            target: teamBillingAccounts.teamId,
            set: { securityState: 'suspended' },
          });
        await tx.insert(platformAdminAudit).values({
          actorUserId: userId,
          teamId,
          targetId: teamId,
          action: 'team.deletion_requested',
        });
      });
    },
    async purgeRows() {
      await authorizeMaintenance();
      return purgeTeamRows(db, teamId);
    },
    async verifyRows() {
      await authorizeMaintenance();
      return verifyTeamRows(db, teamId);
    },
    async updateWork(work: typeof teams.$inferSelect.lifecycleWork) {
      await authorizeMaintenance();
      await db.update(teams).set({ lifecycleWork: work }).where(eq(teams.id, teamId));
    },
    async readLifecycle() {
      await authorizeMaintenance();
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).for('update');
      return team;
    },
  };
}

export const deletionConfirmation = z.object({
  teamId: z.uuid(),
  confirmation: z.string(),
  reason: z.string().trim().min(3).max(1000),
});
