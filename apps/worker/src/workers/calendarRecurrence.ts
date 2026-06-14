import { calendarEvents, type Db } from '@timeline/db';
import { childLogger, queue, withTeam } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';
import { and, asc, gt, isNotNull, isNull, type SQL } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const TEAM_PAGE_SIZE = 1000;
const log = childLogger('worker:calendar-recurrence');

interface CalendarRecurrenceWorkerDeps {
  db: Db;
}

export async function processCalendarRecurrenceTick(
  deps: CalendarRecurrenceWorkerDeps,
  jobId: string | undefined = 'manual',
): Promise<{ materialized: number }> {
  let materialized = 0;
  let lastTeamId: string | null = null;
  let pageCount = 0;

  for (;;) {
    const conditions: SQL[] = [
      isNotNull(calendarEvents.rrule),
      isNull(calendarEvents.recurringParentId),
      isNull(calendarEvents.deletedAt),
    ];
    if (lastTeamId) conditions.push(gt(calendarEvents.teamId, lastTeamId));

    const teams = await deps.db
      .selectDistinct({ teamId: calendarEvents.teamId })
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.teamId))
      .limit(TEAM_PAGE_SIZE);

    pageCount += 1;
    for (const row of teams) {
      const scope = withTeam(deps.db, row.teamId, PSEUDO_USER, { skipMembershipCheck: true });
      materialized += await scope.calendar.materializeRecurringEvents();
    }

    if (teams.length < TEAM_PAGE_SIZE) break;
    lastTeamId = teams[teams.length - 1]?.teamId ?? null;
    if (!lastTeamId) break;
  }
  log.info({ jobId, materialized, pageCount }, 'calendar recurrence materialization complete');
  return { materialized };
}

export function startCalendarRecurrenceWorker(
  deps: CalendarRecurrenceWorkerDeps,
): Worker<queue.CalendarRecurrenceJobData> {
  const worker = new Worker<queue.CalendarRecurrenceJobData>(
    queue.QUEUE_NAMES.calendarRecurrence,
    async (job: Job<queue.CalendarRecurrenceJobData>) =>
      processCalendarRecurrenceTick(deps, job.id),
    {
      connection: queue.getRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'calendar recurrence materialization failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}
