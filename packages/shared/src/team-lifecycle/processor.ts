import { teams, type Db } from '@timeline/db';
import { sql } from 'drizzle-orm';

import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { childLogger } from '#src/logger.js';
import { getQdrantClient } from '#src/qdrant/client.js';
import { lifecycleRows } from '#src/team-lifecycle/result.js';
import { purgeTeamObjects, purgeTeamQueues } from '#src/team-lifecycle/storage.js';
import { withTeam } from '#src/team-scope.js';

const log = childLogger('team-lifecycle');
export interface TeamCleanupIO {
  objects(teamId: string): Promise<boolean>;
  queues(teamId: string): Promise<boolean>;
  vectors(teamId: string): Promise<void>;
}
const defaultIO: TeamCleanupIO = {
  objects: purgeTeamObjects,
  queues: purgeTeamQueues,
  vectors: (teamId) => getQdrantClient({ requireExisting: true }).deleteTeamPoints(teamId),
};

/** DB-backed polling is the outbox: missed queue publishes cannot strand requests. */
export async function processTeamLifecycle(db: Db, io: TeamCleanupIO = defaultIO) {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      sql`
    (${teams.lifecycleWork}->>'botsPending' = 'true' OR ${teams.lifecycleWork}->>'billingPending' = 'true' OR ${teams.lifecycleWork}->>'notificationPending' = 'true'
      OR (${teams.deletionStartedAt} IS NOT NULL AND ${teams.deletedAt} IS NULL))
    AND COALESCE((${teams.lifecycleWork}->>'retryAt')::timestamptz, '-infinity') <= now()
  `,
    )
    .orderBy(teams.id)
    .limit(25);
  for (const row of rows) {
    // Transaction-scoped advisory lock prevents duplicate consumers. Each tick is resumable.
    await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${row.id}, 103)) AS acquired`,
      );
      if (!lifecycleRows(lock)[0]?.acquired) return;
      const scope = withTeam(tx as unknown as Db, row.id, BILLING_SYSTEM_USER_ID, {
        skipMembershipCheck: true,
      }).lifecycle;
      const team = await scope.readLifecycle();
      if (!team) return;
      let work = { ...team.lifecycleWork };
      const failures: boolean[] = [];
      const fail = () => {
        failures.push(true);
      };
      // Successful delivery rows survive unrelated cancellation and cleanup failures.
      if (work.notificationPending) {
        try {
          const complete = await tx.transaction(async (notifyTx) =>
            withTeam(notifyTx as unknown as Db, row.id, BILLING_SYSTEM_USER_ID, {
              skipMembershipCheck: true,
            }).lifecycle.notifyRequest(),
          );
          work.notificationPending = !complete;
          if (!complete) fail();
        } catch {
          fail();
        }
      }
      if (work.billingPending) {
        try {
          await tx.transaction(async (billingTx) =>
            withTeam(billingTx as unknown as Db, row.id, BILLING_SYSTEM_USER_ID, {
              skipMembershipCheck: true,
            }).lifecycle.cancelRenewal(),
          );
          work.billingPending = false;
          delete work.pendingCheckoutIds;
        } catch {
          fail();
        }
      }
      if (team.disabledAt) work.botsPending = true;
      const beforeStage = { ...work };
      try {
        await tx.transaction(async (stageTx) => {
          await stageTx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
          const scope = withTeam(stageTx as unknown as Db, row.id, BILLING_SYSTEM_USER_ID, {
            skipMembershipCheck: true,
          }).lifecycle;
          if (team.disabledAt && !(await scope.stopBots())) {
            work.botsPending = true;
            return;
          }
          delete work.botsPending;
          if (work.billingPending || work.notificationPending) return;
          if (team.deletionStartedAt && !team.deletedAt) {
            if (!work.stage || work.stage === 'inventory') {
              work.connectionIds = await scope.inventoryConnections();
              Object.assign(work, await scope.inventoryIndirect());
              work.stage = 'stop';
            } else if (work.stage === 'stop') {
              const disconnected = await scope.disconnectSources();
              if (disconnected.exceptions.length) {
                const existing = work.followups?.find((item) => item.category === 'processors');
                work.followups = [
                  ...(work.followups ?? []).filter((item) => item.category !== 'processors'),
                  {
                    category: 'processors',
                    status: 'pending',
                    reference: [existing?.reference, ...disconnected.exceptions]
                      .filter(Boolean)
                      .join('; '),
                  },
                ];
              }
              if (disconnected.complete && (await io.queues(team.id))) {
                const nextDay = await scope.settlePriorUsage(work.usageBackfillDay);
                if (nextDay) {
                  work.usageBackfillDay = nextDay;
                  return;
                }
                delete work.usageBackfillDay;
                work.stage = 'purge';
              }
            } else if (work.stage === 'purge') {
              if (!(await io.objects(team.id))) return;
              await io.vectors(team.id);
              if ((await io.queues(team.id)) && (await scope.purgeRows())) {
                await scope.removeUnusedConnections(work.connectionIds ?? []);
                await scope.purgeIndirect(work);
                work.stage = 'verify';
                // Signed uploads and external extraction producers may outlive HTTP requests.
                work.retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
              }
            } else if (work.stage === 'verify') {
              if (!(await io.objects(team.id))) return;
              await io.vectors(team.id);
              if (!(await io.queues(team.id))) throw new Error('active_jobs_pending');
              await scope.verifyRows();
              await scope.finish();
              work.stage = 'complete';
              work.verifiedAt = new Date().toISOString();
              delete work.connectionIds;
              delete work.slackWorkspaceIds;
              delete work.webhookDeliveryIds;
            }
          }
        });
      } catch {
        work = beforeStage;
        fail();
      }
      if (failures.length) {
        // Provider failures can include customer content or credentials: persist only stage metadata.
        work.attempts = (work.attempts ?? 0) + 1;
        work.error = `Cleanup step ${work.stage ?? 'disable'} requires retry`;
        work.retryAt = new Date(
          Date.now() + Math.min(3600000, 60000 * work.attempts),
        ).toISOString();
        log.warn({ teamId: team.id, stage: work.stage }, 'team lifecycle requires retry');
      } else {
        delete work.error;
        if (work.stage !== 'verify') delete work.retryAt;
      }
      await scope.updateWork(work);
    });
  }
}
