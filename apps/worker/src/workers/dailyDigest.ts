import { type Db } from '@timeline/db';
import { childLogger, messaging, queue } from '@timeline/shared';
import { Worker, type Job } from 'bullmq';

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
): Promise<{ recipients?: number; digestId?: string; sent?: boolean; skipped?: boolean }> {
  if (job.kind === 'tick') {
    const window = messaging.defaultDigestWindow();
    const recipients = await messaging.listDailyDigestRecipients(deps.db);
    await Promise.all(
      recipients.map((recipient) =>
        queue.enqueueDailyDigestRecipientJob({
          kind: 'recipient',
          teamId: recipient.teamId,
          userId: recipient.userId,
          email: recipient.email,
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
        }),
      ),
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

  const result = await messaging.sendDailyDigest({
    db: deps.db,
    digestId: job.digestId,
    to: job.email,
    digestUrl: `${siteUrl()}/app`,
  });
  if (!result.ok && !result.skipped) {
    throw new Error(result.error ?? 'Daily digest send failed');
  }
  return {
    digestId: job.digestId,
    sent: result.ok,
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

export function startDailyDigestWorker(deps: { db: Db }): Worker<queue.DailyDigestJobData> {
  const worker = new Worker<queue.DailyDigestJobData>(
    queue.QUEUE_NAMES.dailyDigest,
    async (job: Job<queue.DailyDigestJobData>) => {
      const startedAt = Date.now();
      const result = await processDailyDigestJob(deps, job.data);
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
