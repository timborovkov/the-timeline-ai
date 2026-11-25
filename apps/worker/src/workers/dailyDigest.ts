import { type Db } from '@timeline/db';
import { childLogger, messaging, queue } from '@timeline/shared';
import { ResendError } from '@timeline/shared/email';
import { PlatformAccessError } from '@timeline/shared/platform-admin';
import { withTeam } from '@timeline/shared/team-scope';
import { Worker, DelayedError, type Job } from 'bullmq';

import { withWorkerAiBilling, workerBillingJobOptions } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';
import { guardWorkerProcessor } from '#src/platform-worker.js';

const log = childLogger('worker:daily-digest');

function siteUrl(): string {
  const authUrl = process.env.AUTH_URL;
  if (authUrl) return new URL(authUrl).origin;
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return new URL(`https://${vercelUrl}`).origin;
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl) return new URL(nextAuthUrl).origin;
  return 'http://localhost:3000';
}

export async function processDailyDigestJob(
  deps: { db: Db },
  job: queue.DailyDigestJobData,
  tickAt = new Date(),
): Promise<{
  recipients?: number;
  digestId?: string;
  sent?: boolean;
  skipped?: boolean;
  permanentFailure?: boolean;
}> {
  if (job.kind === 'updates-tick') {
    const now = new Date();
    const scanAt = job.catchup ? now : tickAt;
    const candidates = await messaging.listUpdateDispatchCandidates(deps.db);
    const graceMs = job.catchup ? messaging.UPDATE_DISPATCH_GRACE_MS : 15 * 60_000;
    const due = candidates.flatMap((candidate) => {
      const windowEnd = messaging.latestUpdateTime(candidate.settings, candidate.timezone, scanAt);
      if (
        scanAt.getTime() - windowEnd.getTime() >= graceMs ||
        now.getTime() - windowEnd.getTime() >= messaging.UPDATE_DISPATCH_GRACE_MS ||
        windowEnd < candidate.joinedAt ||
        (candidate.changedAt && windowEnd < candidate.changedAt)
      )
        return [];
      return [
        {
          kind: 'update' as const,
          teamId: candidate.teamId,
          userId: candidate.userId,
          scheduleKey: candidate.key,
          revision: candidate.revision,
          windowEnd: windowEnd.toISOString(),
        },
      ];
    });
    for (let offset = 0; offset < due.length; offset += 50) {
      await Promise.all(
        due.slice(offset, offset + 50).map((data) => queue.enqueueScheduledUpdateJob(data)),
      );
    }
    return { recipients: due.length };
  }

  if (job.kind === 'update') {
    const digestId = await messaging.generateScheduledUpdate({
      scope: withTeam(deps.db, job.teamId, job.userId),
      key: job.scheduleKey,
      revision: job.revision,
      windowEnd: new Date(job.windowEnd),
    });
    if (digestId && job.scheduleKey !== messaging.HOME_UPDATE_KEY) {
      await queue.enqueueScheduledUpdateSendJob({
        kind: 'update-send',
        digestId,
        teamId: job.teamId,
        userId: job.userId,
      });
    }
    return digestId ? { digestId, skipped: false } : { skipped: true };
  }

  if (job.kind === 'tick') {
    const explicitWindow =
      job.reason !== 'catchup' && job.windowStart && job.windowEnd
        ? { start: job.windowStart, end: job.windowEnd }
        : null;
    // Older explicit jobs still run. Recurring member delivery uses the
    // personal scheduler so a workspace receives only one inherited default.
    const recipients = job.reason ? [] : await messaging.listDailyDigestRecipients(deps.db);
    await Promise.all(
      recipients.map(async (recipient) => {
        const preference = explicitWindow
          ? null
          : await messaging.getDigestPreference({
              db: deps.db,
              teamId: recipient.teamId,
              userId: recipient.userId,
            });
        const window = explicitWindow
          ? { start: new Date(explicitWindow.start), end: new Date(explicitWindow.end) }
          : messaging.defaultDigestWindow(new Date(), preference?.timezone, preference?.hour);
        await queue.enqueueDailyDigestRecipientJob({
          kind: 'recipient',
          teamId: recipient.teamId,
          userId: recipient.userId,
          email: recipient.email,
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
        });
      }),
    );
    const sharedTeamIds = await messaging.listWorkspaceDigestTeamIds(deps.db);
    await Promise.all(
      sharedTeamIds.map(async (teamId) => {
        const schedule = await messaging.getWorkspaceDigestSchedule(deps.db, teamId);
        const window = explicitWindow
          ? { start: new Date(explicitWindow.start), end: new Date(explicitWindow.end) }
          : messaging.defaultDigestWindow(new Date(), schedule.timezone, schedule.hour);
        await queue.enqueueDailyDigestWorkspaceSendJob({
          kind: 'workspace-send',
          teamId,
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
        });
      }),
    );
    return { recipients: recipients.length };
  }

  if (job.kind === 'recipient') {
    const result = await messaging.generateDailyDigest({
      db: deps.db,
      teamId: job.teamId,
      userId: job.userId,
      windowStart: new Date(job.windowStart),
      windowEnd: new Date(job.windowEnd),
    });
    if (!result.skipped && result.digestId) {
      await queue.enqueueDailyDigestSendJob({
        kind: 'send',
        digestId: result.digestId,
        email: job.email,
      });
    }
    return { digestId: result.digestId, skipped: result.skipped };
  }

  if (job.kind === 'workspace-send') {
    const result = await messaging.sendWorkspaceDailyDigest({
      db: deps.db,
      teamId: job.teamId,
      windowStart: new Date(job.windowStart),
      windowEnd: new Date(job.windowEnd),
      digestUrl: `${siteUrl()}/app`,
    });
    if (!result.ok && !result.skipped && result.retryable !== false) {
      if (result.retryAfterMs) throw new ResendError('rate_limited', true, result.retryAfterMs);
      throw new Error(result.error ?? 'Workspace daily digest send failed');
    }
    return {
      sent: result.ok,
      ...(result.skipped ? { skipped: result.skipped } : {}),
      ...(!result.ok && result.retryable === false ? { permanentFailure: true } : {}),
    };
  }

  const result = await messaging.sendDailyDigest({
    db: deps.db,
    digestId: job.digestId,
    ...(job.kind === 'send' ? { to: job.email } : {}),
    digestUrl: `${siteUrl()}/app/digests?digest=${job.digestId}`,
  });
  // Permanent provider failures (e.g. Resend inactive recipient) are already
  // recorded on the digest/delivery rows — retrying only burns attempts + Sentry.
  if (!result.ok && !result.skipped && result.retryable !== false) {
    if (result.retryAfterMs) throw new ResendError('rate_limited', true, result.retryAfterMs);
    throw new Error(result.error ?? 'Daily digest send failed');
  }
  return {
    digestId: job.digestId,
    sent: result.ok,
    ...(result.skipped ? { skipped: result.skipped } : {}),
    ...(!result.ok && result.retryable === false ? { permanentFailure: true } : {}),
  };
}

function digestBillingTeamId(job: queue.DailyDigestJobData): string | undefined {
  return job.kind === 'recipient' || job.kind === 'update' || job.kind === 'workspace-send'
    ? job.teamId
    : undefined;
}

function digestJobTeamId(job: queue.DailyDigestJobData): string | undefined {
  return 'teamId' in job ? job.teamId : undefined;
}

/** Complete already-queued digest work for a suspended principal without retry or Sentry. */
export async function skipSuspendedDigestAccess<T>(
  job: Pick<Job<queue.DailyDigestJobData>, 'id' | 'data'>,
  run: () => Promise<T>,
): Promise<T | { skipped: true }> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PlatformAccessError)) throw error;
    log.info(
      {
        jobId: job.id,
        kind: job.data.kind,
        teamId: digestJobTeamId(job.data),
        err: error.message,
      },
      'skipping digest job for suspended principal',
    );
    return { skipped: true };
  }
}

export function startDailyDigestWorker(
  deps: { db: Db },
  queueName:
    typeof queue.QUEUE_NAMES.dailyDigest | typeof queue.QUEUE_NAMES.scheduledUpdates = queue
    .QUEUE_NAMES.dailyDigest,
): Worker<queue.DailyDigestJobData> {
  const process = guardWorkerProcessor(
    deps.db,
    async (job: Job<queue.DailyDigestJobData>, token?: string) => {
      const startedAt = Date.now();
      const result = await withWorkerAiBilling(
        deps.db,
        digestBillingTeamId(job.data),
        'digest',
        () => processDailyDigestJob(deps, job.data, new Date(job.opts.prevMillis ?? job.timestamp)),
        workerBillingJobOptions(job, token),
      ).catch(async (error: unknown) => {
        if (
          error instanceof ResendError &&
          error.retryAfterMs > 0 &&
          job.attemptsStarted < (job.opts.attempts ?? 8)
        ) {
          await job.moveToDelayed(Date.now() + error.retryAfterMs, token);
          throw new DelayedError();
        }
        throw error;
      });
      if (job.data.kind === 'tick' && job.data.reason === 'scheduled') {
        await queue.recordDailyDigestTick(job.opts.prevMillis ?? job.timestamp);
      }
      if (job.data.kind === 'updates-tick' && !job.data.catchup) {
        await queue.recordScheduledUpdatesTick(job.opts.prevMillis ?? job.timestamp);
      }
      log.info(
        { jobId: job.id, ...result, durationMs: Date.now() - startedAt },
        'digest job complete',
      );
      return result;
    },
  );
  const worker = new Worker<queue.DailyDigestJobData>(
    queueName,
    (job, token, signal) => skipSuspendedDigestAccess(job, () => process(job, token, signal)),
    { connection: queue.getRedisConnection(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'daily digest job failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}
