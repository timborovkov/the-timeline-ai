import { calendarEvents, type Db } from '@timeline/db';
import { childLogger, queue, withTeam } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';
import { sql } from 'drizzle-orm';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const log = childLogger('worker:calendar-recurrence');

interface CalendarRecurrenceWorkerDeps {
  db: Db;
}

async function processCalendarRecurrenceTick(
  deps: CalendarRecurrenceWorkerDeps,
  jobId: string | undefined = 'manual',
): Promise<{ materialized: number }> {
  const teams = await deps.db
    .selectDistinct({ teamId: calendarEvents.teamId })
    .from(calendarEvents)
    .where(
      sql`${calendarEvents.rrule} IS NOT NULL
        AND ${calendarEvents.recurringParentId} IS NULL
        AND ${calendarEvents.deletedAt} IS NULL`,
    )
    .limit(1000);
  let materialized = 0;
  for (const row of teams) {
    const scope = withTeam(deps.db, row.teamId, PSEUDO_USER, { skipMembershipCheck: true });
    materialized += await scope.calendar.materializeRecurringEvents();
  }
  log.info({ jobId, materialized }, 'calendar recurrence materialization complete');
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
