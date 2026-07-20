import { type Db, entities, notifications, teamCalendarSettings } from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';
import { presentDueDate } from '@timeline/shared/time';
import { Worker, type Job } from 'bullmq';
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

// Page the overdue scan by entity id so a tenant with thousands of
// overdue tasks can't blow memory on a single SELECT, and the bulk
// INSERT after stays bounded too. UUIDs sort lexicographically which is
// fine for stable keyset pagination — we just need an ordering that's
// total and stable, not chronological.
const PAGE_SIZE = 500;
// Safety cap for one tick. The dedup index swallows repeats, so a missed
// page is just delayed by one hour. Better to bound worst-case work per
// tick than to lock up a worker for hours on a degenerate workspace.
const MAX_ENTITIES_PER_TICK = 50_000;
const DEFAULT_WORKSPACE_TIMEZONE = 'Europe/Helsinki';

const log = childLogger('worker:overdue');

interface OverdueWorkerDeps {
  db: Db;
}

export interface OverdueScanResult {
  scanned: number;
  inserted: number;
}

/**
 * Hourly scan: finds tasks and follow_ups with due_at in the past that aren't
 * already done or cancelled, and inserts one `task_overdue` / `follow_up_overdue`
 * notification per (owner|assignee). Per-day dedup lives in the database via
 * the unique index `notifications_overdue_dedup_idx` — `ON CONFLICT DO NOTHING`
 * makes repeated runs in the same calendar day cheap.
 *
 * Operates across all teams in a single pass. The scope/team isolation that
 * matters for user-facing reads is preserved by the per-row teamId we copy
 * from the entity into the notification.
 */
export async function processOverdueScanTick(
  deps: OverdueWorkerDeps,
  jobId: string | undefined = 'manual',
): Promise<OverdueScanResult> {
  const safeTimezone = sql<string>`CASE
    WHEN EXISTS (
      SELECT 1
      FROM pg_timezone_names
      WHERE name = ${teamCalendarSettings.defaultTimezone}
    ) THEN ${teamCalendarSettings.defaultTimezone}
    ELSE ${DEFAULT_WORKSPACE_TIMEZONE}
  END`;
  let cursor: string | null = null;
  let totalScanned = 0;
  let totalInserted = 0;

  while (totalScanned < MAX_ENTITIES_PER_TICK) {
    const overdueRows: {
      id: string;
      teamId: string;
      type: typeof entities.$inferSelect.type;
      canonicalName: string;
      ownerUserId: string | null;
      assigneeUserId: string | null;
      dueAt: Date | null;
      timezone: string;
    }[] = await deps.db
      .select({
        id: entities.id,
        teamId: entities.teamId,
        type: entities.type,
        canonicalName: entities.canonicalName,
        ownerUserId: entities.ownerUserId,
        assigneeUserId: entities.assigneeUserId,
        dueAt: entities.dueAt,
        timezone: safeTimezone,
      })
      .from(entities)
      .leftJoin(teamCalendarSettings, eq(teamCalendarSettings.teamId, entities.teamId))
      .where(
        and(
          inArray(entities.type, ['task', 'follow_up']),
          isNotNull(entities.dueAt),
          // Canonical UTC-midnight values encode a calendar date directly.
          // Legacy/non-midnight instants resolve to a date in the workspace
          // timezone. In both cases the item becomes overdue only after that
          // local calendar day has ended.
          sql`(
            CASE
              WHEN EXTRACT(HOUR FROM ${entities.dueAt} AT TIME ZONE 'UTC') = 0
                AND EXTRACT(MINUTE FROM ${entities.dueAt} AT TIME ZONE 'UTC') = 0
                AND EXTRACT(SECOND FROM ${entities.dueAt} AT TIME ZONE 'UTC') = 0
              THEN (${entities.dueAt} AT TIME ZONE 'UTC')::date
              ELSE (${entities.dueAt} AT TIME ZONE ${safeTimezone})::date
            END
          ) < (now() AT TIME ZONE ${safeTimezone})::date`,
          sql`lower(${entities.status}) NOT IN ('done', 'cancelled', 'canceled', 'shipped', 'suggested')`,
          // Don't badger users about agent-suggested tasks they haven't
          // accepted yet. The suggestion already produces an
          // `agent_suggestion` notification via `createObject`; piling
          // `task_overdue` on top would be noise. Once accepted the
          // status flips to 'todo' and the overdue clock starts.
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          // Keyset pagination by id. NULL on the first iteration → no
          // additional predicate, otherwise restrict to ids strictly
          // greater than the last page's max. UUIDs sort lexically;
          // that's a total stable order, which is all keyset needs.
          cursor ? gt(entities.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(entities.id))
      .limit(PAGE_SIZE);

    if (overdueRows.length === 0) break;
    totalScanned += overdueRows.length;
    cursor = overdueRows[overdueRows.length - 1]?.id ?? null;

    // Build one notification per (row, recipient). owner OR assignee — if
    // both are set and differ, both are notified; if they're the same user,
    // a Set keeps it to one row. Rows without any recipient are skipped
    // (nobody to page).
    const values: (typeof notifications.$inferInsert)[] = [];
    for (const r of overdueRows) {
      const recipients = new Set<string>();
      if (r.ownerUserId) recipients.add(r.ownerUserId);
      if (r.assigneeUserId) recipients.add(r.assigneeUserId);
      if (recipients.size === 0) continue;
      const kind = r.type === 'task' ? 'task_overdue' : 'follow_up_overdue';
      const due = presentDueDate(r.dueAt, { timezone: r.timezone });
      const dueText = due.dateLabel ? `${due.label} · ${due.dateLabel}` : due.compactText;
      for (const userId of recipients) {
        values.push({
          teamId: r.teamId,
          userId,
          kind,
          entityId: r.id,
          summary: `${r.canonicalName} is overdue (${dueText})`,
          payload: {
            entity_id: r.id,
            type: r.type,
            due_at: r.dueAt?.toISOString() ?? null,
          },
        });
      }
    }

    let pageInserted = 0;
    if (values.length > 0) {
      // Per-day dedup index swallows repeats. `onConflictDoNothing()`
      // without an explicit target intentionally — drizzle's typed
      // `target` only accepts column references, but our dedup index is
      // a partial expression index (`(created_at::date)` with `WHERE kind
      // IN (...)`) that drizzle can't express. Per the Postgres docs, ON
      // CONFLICT DO NOTHING without a conflict_target catches violations
      // against ANY unique constraint or unique index — including partial
      // ones. The partial index's WHERE clause means it only "sees" rows
      // whose `kind` is in its allowlist, so other notification kinds
      // (object_changed, mentions, …) can still fire multiple times per
      // day without colliding.
      const inserted = await deps.db
        .insert(notifications)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      pageInserted = inserted.length;
      totalInserted += pageInserted;
    }

    log.info(
      {
        jobId,
        pageScanned: overdueRows.length,
        pageInserted,
        scanned: totalScanned,
        inserted: totalInserted,
      },
      'overdue scan page complete',
    );

    // Last page when the result was smaller than the page size; saves
    // a wasted round-trip for an empty follow-up SELECT.
    if (overdueRows.length < PAGE_SIZE) break;
  }

  if (totalScanned === 0) {
    log.info({ jobId }, 'overdue scan: no rows');
    return { scanned: 0, inserted: 0 };
  }
  if (totalScanned >= MAX_ENTITIES_PER_TICK) {
    log.warn(
      { jobId, scanned: totalScanned, cap: MAX_ENTITIES_PER_TICK },
      'overdue scan hit per-tick cap; remainder rolls to next tick',
    );
  }
  return { scanned: totalScanned, inserted: totalInserted };
}

export function startOverdueWorker(deps: OverdueWorkerDeps): Worker<queue.OverdueScanJobData> {
  const worker = new Worker<queue.OverdueScanJobData>(
    queue.QUEUE_NAMES.overdueScan,
    async (job: Job<queue.OverdueScanJobData>) => {
      const startedAt = Date.now();
      const result = await processOverdueScanTick(deps, job.id);
      log.info(
        {
          jobId: job.id,
          scanned: result.scanned,
          inserted: result.inserted,
          durationMs: Date.now() - startedAt,
        },
        'overdue scan complete',
      );
      return result;
    },
    {
      connection: queue.getRedisConnection(),
      // Singleton consumer is fine — the scan is cheap and there's no value
      // in concurrent runs. If a tick is missed (worker restart) the next
      // hourly tick covers the gap and the dedup index handles the rest.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'overdue scan failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}
