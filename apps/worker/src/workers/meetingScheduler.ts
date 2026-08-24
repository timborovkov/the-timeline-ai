import { type Db, meetings, meetingUsage, savedMeetings, teamMeetingSettings } from '@timeline/db';
import { childLogger, meetingBots, queue, withTeam } from '@timeline/shared';
import {
  assertTeamConcurrentRecallCapacity,
  isBillingAdmissionError,
  releaseBillingReservation,
  reserveRecallMeetingMinutes,
  runWithConcurrentRecallJoinLock,
} from '@timeline/shared/billing';
import { Worker, type Job } from 'bullmq';
import { and, asc, eq, exists, gt, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { captureWorkerException } from '#src/monitoring.js';

const log = childLogger('worker:meeting-scheduler');
const PSEUDO_USER = '00000000-0000-0000-0000-000000000000';
const MAX_JOIN_OFFSET_MS = 30 * 60 * 1000;
const DEFAULT_JOIN_OFFSET_MS = 2 * 60 * 1000;
const SCHEDULED_JOIN_LOOKBACK_MS = 550 * 1000;
const FAILURE_PAUSE_THRESHOLD = 3;

interface MeetingSchedulerDeps {
  db: Db;
}

async function teamHasMeetingCapacity(db: Db, teamId: string): Promise<boolean> {
  const [settings] = await db
    .select()
    .from(teamMeetingSettings)
    .where(eq(teamMeetingSettings.teamId, teamId))
    .limit(1);
  const cap = settings ? settings.meetingMinutesCap : 600;
  if (cap === null || settings?.meetingMinutesAdminOverride) return true;
  if (cap === 0) return false;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [used] = await db
    .select({ total: sql<number>`COALESCE(SUM(${meetingUsage.minutes}), 0)::int` })
    .from(meetingUsage)
    .where(and(eq(meetingUsage.teamId, teamId), gte(meetingUsage.recordedAt, monthStart)));
  return (used?.total ?? 0) < cap;
}

async function incrementSavedMeetingFailure(db: Db, savedMeetingId: string): Promise<void> {
  const [row] = await db
    .update(savedMeetings)
    .set({
      consecutiveFailureCount: sql`${savedMeetings.consecutiveFailureCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(savedMeetings.id, savedMeetingId))
    .returning({ consecutiveFailureCount: savedMeetings.consecutiveFailureCount });
  if (row && row.consecutiveFailureCount >= FAILURE_PAUSE_THRESHOLD) {
    await db
      .update(savedMeetings)
      .set({
        autoJoinPausedAt: new Date(),
        autoJoinPausedReason: 'consecutive_failures',
        autoJoinEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(savedMeetings.id, savedMeetingId));
  }
}

function joinOffsetMs(scheduleConfig: unknown): number {
  if (!scheduleConfig || typeof scheduleConfig !== 'object') return DEFAULT_JOIN_OFFSET_MS;
  const raw = scheduleConfig as Record<string, unknown>;
  return typeof raw.joinOffsetMinutes === 'number' && Number.isFinite(raw.joinOffsetMinutes)
    ? Math.max(0, Math.min(30, Math.trunc(raw.joinOffsetMinutes))) * 60 * 1000
    : DEFAULT_JOIN_OFFSET_MS;
}

export async function processMeetingSchedulerTick(deps: MeetingSchedulerDeps): Promise<{
  materialized: number;
  joined: number;
  failed: number;
}> {
  const now = new Date();
  const expiredRetry = deps.db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.savedMeetingId, savedMeetings.id),
        eq(meetings.status, 'scheduled'),
        isNotNull(meetings.scheduledEndAt),
        lte(meetings.scheduledEndAt, now),
        sql`(${meetings.metadata} ->> 'no_show_retry_count') = '1'`,
      ),
    );
  const schedulerSaved = await deps.db
    .select({
      id: savedMeetings.id,
      teamId: savedMeetings.teamId,
      autoJoinEnabled: savedMeetings.autoJoinEnabled,
      autoJoinPausedAt: savedMeetings.autoJoinPausedAt,
      archivedAt: savedMeetings.archivedAt,
    })
    .from(savedMeetings)
    .where(
      or(
        and(
          eq(savedMeetings.autoJoinEnabled, true),
          isNull(savedMeetings.autoJoinPausedAt),
          isNull(savedMeetings.archivedAt),
        ),
        exists(expiredRetry),
      ),
    );

  let materialized = 0;
  let failed = 0;
  const expiredRetryTeams = new Set<string>();
  for (const saved of schedulerSaved) {
    const scope = withTeam(deps.db, saved.teamId, PSEUDO_USER, { skipMembershipCheck: true });
    if (!expiredRetryTeams.has(saved.teamId)) {
      failed += await scope.meetings.expireSavedMeetingNoShowRetries(now);
      expiredRetryTeams.add(saved.teamId);
    }
    if (saved.autoJoinEnabled && !saved.autoJoinPausedAt && !saved.archivedAt) {
      materialized += await scope.meetings.materializeSavedMeetingOccurrences(saved.id);
    }
  }

  const startWindowEnd = new Date(now.getTime() + MAX_JOIN_OFFSET_MS);
  const due = await deps.db
    .select({ meeting: meetings, scheduleConfig: savedMeetings.scheduleConfig })
    .from(meetings)
    .innerJoin(savedMeetings, eq(meetings.savedMeetingId, savedMeetings.id))
    .where(
      and(
        eq(meetings.status, 'scheduled'),
        eq(savedMeetings.autoJoinEnabled, true),
        isNull(savedMeetings.autoJoinPausedAt),
        isNull(savedMeetings.archivedAt),
        or(
          gte(meetings.scheduledStartAt, new Date(now.getTime() - SCHEDULED_JOIN_LOOKBACK_MS)),
          and(
            sql`(${meetings.metadata} ->> 'no_show_retry_count') = '1'`,
            or(isNull(meetings.scheduledEndAt), gt(meetings.scheduledEndAt, now)),
          ),
        ),
        lte(meetings.scheduledStartAt, startWindowEnd),
      ),
    )
    .orderBy(asc(meetings.scheduledStartAt))
    .limit(100);

  let joined = 0;
  for (const dueRow of due) {
    const meeting = dueRow.meeting;
    if (!meeting.savedMeetingId) continue;
    if (
      meeting.scheduledStartAt &&
      meeting.scheduledStartAt.getTime() > now.getTime() + joinOffsetMs(dueRow.scheduleConfig)
    ) {
      continue;
    }
    const scope = withTeam(deps.db, meeting.teamId, PSEUDO_USER, { skipMembershipCheck: true });
    if (!(await teamHasMeetingCapacity(deps.db, meeting.teamId))) {
      await scope.meetings.updateMeetingStatus(meeting.id, 'failed', {
        metadata: { join_failed_at: new Date().toISOString(), join_error: 'meeting_cap_reached' },
      });
      await incrementSavedMeetingFailure(deps.db, meeting.savedMeetingId);
      failed += 1;
      continue;
    }
    try {
      const claimed = await runWithConcurrentRecallJoinLock(deps.db, meeting.teamId, async (tx) => {
        await assertTeamConcurrentRecallCapacity({ db: tx, teamId: meeting.teamId });
        return tx
          .update(meetings)
          .set({
            status: 'joining',
            updatedAt: new Date(),
            metadata: sql`COALESCE(${meetings.metadata}, '{}'::jsonb) || '{"scheduler_claimed":true}'::jsonb`,
          })
          .where(
            and(
              eq(meetings.id, meeting.id),
              eq(meetings.teamId, meeting.teamId),
              eq(meetings.status, 'scheduled'),
              sql`(
              COALESCE(${meetings.metadata} ->> 'no_show_retry_count', '0') <> '1'
              OR ${meetings.scheduledEndAt} IS NULL
              OR ${meetings.scheduledEndAt} > now()
            )`,
              sql`NOT EXISTS (
              SELECT 1 FROM meetings active
              WHERE active.team_id = ${meetings.teamId}
                AND active.meeting_url = ${meetings.meetingUrl}
                AND active.status IN ('joining', 'active')
                AND active.id <> ${meetings.id}
            )`,
            ),
          )
          .returning({ id: meetings.id });
      });
      if (!claimed[0]) {
        failed += await scope.meetings.expireSavedMeetingNoShowRetries(new Date());
        continue;
      }

      const admission = await reserveRecallMeetingMinutes(scope.billing, {
        meetingId: meeting.id,
      });
      if (!admission.ok) {
        await scope.meetings.updateMeetingStatus(meeting.id, 'failed', {
          metadata: {
            join_failed_at: new Date().toISOString(),
            join_error: admission.code,
          },
        });
        await incrementSavedMeetingFailure(deps.db, meeting.savedMeetingId);
        failed += 1;
        continue;
      }

      try {
        const team = await scope.timeline.team();
        const provider = meetingBots.getMeetingBotProvider(meeting.provider);
        const join = await provider.joinMeeting({
          meetingId: meeting.id,
          teamId: meeting.teamId,
          meetingUrl: meeting.meetingUrl,
          platform: meeting.platform,
          botName: meetingBots.meetingBotDisplayName(team?.name),
          transcriptWebhookUrl: meetingBots.resolveTranscriptWebhookUrl(),
          maxRecordingDurationSeconds: admission.reservedMinutes * 60,
        });
        await scope.meetings.updateMeetingStatus(meeting.id, 'joining', {
          providerBotId: join.botId,
          metadata: {
            provider_join_result: join.raw ?? {},
            billing_operation_id: admission.operationId,
            reserved_recall_minutes: admission.reservedMinutes,
            reserved_recall_started_at: new Date().toISOString(),
          },
        });
        joined += 1;
      } catch (err) {
        log.warn({ err, meetingId: meeting.id }, 'scheduled_meeting_join_failed');
        await releaseBillingReservation(scope.billing, admission.operationId).catch(
          () => undefined,
        );
        await scope.meetings.updateMeetingStatus(meeting.id, 'failed', {
          metadata: {
            join_failed_at: new Date().toISOString(),
            join_error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          },
        });
        await incrementSavedMeetingFailure(deps.db, meeting.savedMeetingId);
        failed += 1;
      }
    } catch (err) {
      if (isBillingAdmissionError(err)) {
        continue;
      }
      log.warn({ err, meetingId: meeting.id }, 'scheduled_meeting_join_failed');
      await scope.meetings.updateMeetingStatus(meeting.id, 'failed', {
        metadata: {
          join_failed_at: new Date().toISOString(),
          join_error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
        },
      });
      await incrementSavedMeetingFailure(deps.db, meeting.savedMeetingId);
      failed += 1;
    }
  }

  return { materialized, joined, failed };
}

export function startMeetingSchedulerWorker(
  deps: MeetingSchedulerDeps,
): Worker<queue.MeetingSchedulerJobData> {
  const worker = new Worker<queue.MeetingSchedulerJobData>(
    queue.QUEUE_NAMES.meetingScheduler,
    async (_job: Job<queue.MeetingSchedulerJobData>) => processMeetingSchedulerTick(deps),
    { connection: queue.getRedisConnection() },
  );
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'meeting_scheduler_failed');
    captureWorkerException(err, {
      jobName: job?.name,
      queueName: queue.QUEUE_NAMES.meetingScheduler,
    });
  });
  return worker;
}
