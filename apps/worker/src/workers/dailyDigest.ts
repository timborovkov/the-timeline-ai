import { type Db } from '@timeline/db';
import { childLogger, messaging, queue } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';

import { withWorkerAiBilling } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

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
): Promise<{
  recipients?: number;
  digestId?: string;
  sent?: boolean;
  skipped?: boolean;
  permanentFailure?: boolean;
}> {
  if (job.kind === 'tick') {
    const explicitWindow =
      job.reason !== 'catchup' && job.windowStart && job.windowEnd
        ? { start: job.windowStart, end: job.windowEnd }
        : null;
    const recipients = await messaging.listDailyDigestRecipients(deps.db);
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
    to: job.email,
    digestUrl: `${siteUrl()}/app/digests?digest=${job.digestId}`,
  });
  // Permanent provider failures (e.g. Postmark inactive recipient) are already
  // recorded on the digest/delivery rows — retrying only burns attempts + Sentry.
  if (!result.ok && !result.skipped && result.retryable !== false) {
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
  return job.kind === 'recipient' || job.kind === 'workspace-send' ? job.teamId : undefined;
}

export function startDailyDigestWorker(deps: { db: Db }): Worker<queue.DailyDigestJobData> {
  const worker = new Worker<queue.DailyDigestJobData>(
    queue.QUEUE_NAMES.dailyDigest,
    async (job: Job<queue.DailyDigestJobData>) => {
      const startedAt = Date.now();
      const result = await withWorkerAiBilling(
        deps.db,
        digestBillingTeamId(job.data),
        'digest',
        () => processDailyDigestJob(deps, job.data),
      );
      log.info(
        { jobId: job.id, ...result, durationMs: Date.now() - startedAt },
        'digest job complete',
      );
      return result;
    },
    { connection: queue.getRedisConnection(), concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'daily digest job failed');
    captureWorkerJobFailure(err, job);
  });

  return worker;
}
