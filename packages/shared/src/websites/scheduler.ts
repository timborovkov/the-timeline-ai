import {
  type Db,
  websites,
  websiteRuns,
  websiteNotifications,
  documentVersions,
  rawEvents,
} from '@timeline/db';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';

import { getEnv } from '#src/env.js';
import { PlatformAccessError } from '#src/platform-admin/index.js';
import { runGuardedJob } from '#src/platform-admin/runtime.js';
import { getChatDeliveryQueue, enqueueWebsiteScanJob } from '#src/queue/queues.js';
import { withTeam } from '#src/team-scope.js';
import { authorizeWebsitePrincipal } from '#src/websites/authorization.js';
import { failWebsiteRun } from '#src/websites/recovery.js';
import { startWebsiteScan } from '#src/websites/runtime.js';

const activeTeam = (teamId: typeof websites.teamId | typeof websiteRuns.teamId) =>
  sql`EXISTS (SELECT 1 FROM teams WHERE id = ${teamId} AND disabled_at IS NULL AND deletion_started_at IS NULL AND deleted_at IS NULL)`;

/** Worker inventory only. Per-team actions re-enter withTeam with the original actor. */
export async function tickWebsiteSchedules(db: Db): Promise<void> {
  // Sweep before delivery so a queue outage cannot extend credential retention.
  await db
    .delete(websiteNotifications)
    .where(
      sql`${websiteNotifications.createdAt} < now() - interval '48 hours' OR ${websiteNotifications.runId} IN (SELECT id FROM website_runs WHERE finished_at < now() - interval '24 hours')`,
    );

  const abandoned = await db
    .select()
    .from(websiteRuns)
    .where(
      and(
        activeTeam(websiteRuns.teamId),
        sql`${websiteRuns.finishedAt} IS NOT NULL AND ${websiteRuns.providerStartedAt} IS NOT NULL AND ${websiteRuns.providerFinishedAt} IS NULL`,
      ),
    )
    .limit(100);
  for (const run of abandoned)
    await failWebsiteRun(db, run.teamId, run.id, run.failureReason ?? 'cancelled');
  const notifications = await db
    .select({ notification: websiteNotifications, run: websiteRuns })
    .from(websiteNotifications)
    .innerJoin(
      websiteRuns,
      and(
        eq(websiteRuns.id, websiteNotifications.runId),
        eq(websiteRuns.teamId, websiteNotifications.teamId),
      ),
    )
    .where(and(activeTeam(websiteRuns.teamId), sql`${websiteRuns.finishedAt} IS NOT NULL`))
    .limit(100);
  for (const { notification, run } of notifications) {
    await getChatDeliveryQueue().add(
      'deliver',
      {
        teamId: run.teamId,
        userId: run.requestedBy,
        ...(run.platformOperatorSessionId
          ? { platformOperatorSessionId: run.platformOperatorSessionId }
          : {}),
        ciphertext: notification.ciphertext,
        iv: notification.iv,
        tag: notification.tag,
      },
      {
        jobId: `website-result-${run.id}`,
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 24 * 3600 },
      },
    );
    await db
      .delete(websiteNotifications)
      .where(
        and(eq(websiteNotifications.teamId, run.teamId), eq(websiteNotifications.runId, run.id)),
      );
  }
  const pending = await db
    .select()
    .from(websiteRuns)
    .where(
      and(
        activeTeam(websiteRuns.teamId),
        sql`${websiteRuns.status} IN ('queued','crawling','processing') AND ${websiteRuns.billingPolicy} <> 'legacy'`,
      ),
    )
    .orderBy(asc(websiteRuns.createdAt));
  for (const run of pending) {
    try {
      await runGuardedJob(
        {
          teamId: run.teamId,
          userId: run.requestedBy,
          scanId: run.id,
          ...(run.platformOperatorSessionId
            ? { platformOperatorSessionId: run.platformOperatorSessionId }
            : {}),
        },
        async () => {
          const scope = withTeam(db, run.teamId, run.requestedBy, {
            skipMembershipCheck: run.principal?.authType === 'api_key',
            ...(run.principal ? { websitePrincipal: run.principal } : {}),
          });
          if (run.principal) await authorizeWebsitePrincipal(db, run.principal, 'websites:scan');
          await scope.requireMembership();
          if (run.createdAt.getTime() < Date.now() - 86_400_000) {
            await failWebsiteRun(db, run.teamId, run.id, 'processing_timeout');
            return;
          }
          if (run.status === 'queued') {
            await enqueueWebsiteScanJob({
              teamId: run.teamId,
              userId: run.requestedBy,
              scanId: run.id,
              ...(run.platformOperatorSessionId
                ? { platformOperatorSessionId: run.platformOperatorSessionId }
                : {}),
            });
          } else if (run.handoffAt) {
            const [unfinished] = await db
              .select({ id: documentVersions.id })
              .from(documentVersions)
              .innerJoin(rawEvents, eq(rawEvents.id, documentVersions.sourceEventId))
              .where(
                and(
                  eq(documentVersions.teamId, run.teamId),
                  eq(rawEvents.teamId, run.teamId),
                  sql`${rawEvents.sourceMetadata}->>'websiteScanId' = ${run.id}`,
                  sql`${documentVersions.processingStatus} <> 'embedded'`,
                ),
              )
              .limit(1);
            if (!unfinished)
              await scope.websites.updateRun(run.id, {
                status: run.failureReason ? 'partial' : 'completed',
                finishedAt: new Date(),
              });
            else if (run.handoffAt.getTime() < Date.now() - 86_400_000)
              await scope.websites.updateRun(run.id, {
                status: 'partial',
                failureReason: 'processing_incomplete',
                finishedAt: new Date(),
              });
          }
        },
        db,
      );
    } catch (error) {
      if (
        error instanceof PlatformAccessError ||
        (error instanceof Error &&
          /member|revoked|expired|authorized|permission|suspended/i.test(error.message))
      ) {
        await failWebsiteRun(db, run.teamId, run.id, 'actor_no_longer_authorized');
        if (run.platformOperatorSessionId)
          await db
            .update(websites)
            .set({ paused: true, nextScanAt: null, blockedReason: 'schedule_authorization_lost' })
            .where(
              and(
                eq(websites.teamId, run.teamId),
                eq(websites.id, run.websiteId),
                eq(websites.scheduleOperatorSessionId, run.platformOperatorSessionId),
              ),
            );
      }
    }
  }
  if (!getEnv().WEBSITE_SCHEDULES_ENABLED || getEnv().WEBSITE_CRAWLS_DISABLED) return;
  const due = await db
    .select()
    .from(websites)
    .where(
      and(
        activeTeam(websites.teamId),
        isNull(websites.archivedAt),
        eq(websites.paused, false),
        lte(websites.nextScanAt, new Date()),
      ),
    )
    .orderBy(asc(websites.nextScanAt), asc(websites.id));
  for (const source of due) {
    const dueAt = source.nextScanAt;
    const scheduleBy = source.scheduleBy;
    if (!dueAt || !scheduleBy) continue;
    try {
      await runGuardedJob(
        {
          teamId: source.teamId,
          userId: scheduleBy,
          ...(source.scheduleOperatorSessionId
            ? { platformOperatorSessionId: source.scheduleOperatorSessionId }
            : {}),
        },
        async () => {
          const scope = withTeam(db, source.teamId, scheduleBy, {
            skipMembershipCheck: source.schedulePrincipal?.authType === 'api_key',
            ...(source.schedulePrincipal ? { websitePrincipal: source.schedulePrincipal } : {}),
          });
          if (source.schedulePrincipal)
            await authorizeWebsitePrincipal(db, source.schedulePrincipal, 'websites:manage');
          else {
            const role = await scope.requireMembership('admin');
            if (role === 'member') return;
          }
          await startWebsiteScan(scope, {
            websiteId: source.id,
            idempotencyKey: `schedule:${source.id}:${dueAt.toISOString()}`,
            trigger: 'scheduled',
            permissionConfirmed: true,
          });
          await scope.websites.advanceSchedule(source.id, dueAt);
        },
        db,
      );
    } catch (error) {
      if (
        error instanceof PlatformAccessError ||
        (error instanceof Error &&
          /member|revoked|expired|authorized|permission|suspended|admin/i.test(error.message))
      )
        await db
          .update(websites)
          .set({ paused: true, nextScanAt: null, blockedReason: 'schedule_authorization_lost' })
          .where(
            and(
              eq(websites.teamId, source.teamId),
              eq(websites.id, source.id),
              eq(websites.nextScanAt, dueAt),
              eq(websites.scheduleBy, scheduleBy),
              source.schedulePrincipal
                ? sql`${websites.schedulePrincipal} = ${JSON.stringify(source.schedulePrincipal)}::jsonb`
                : isNull(websites.schedulePrincipal),
              source.scheduleOperatorSessionId
                ? eq(websites.scheduleOperatorSessionId, source.scheduleOperatorSessionId)
                : isNull(websites.scheduleOperatorSessionId),
            ),
          );
    }
  }
}
