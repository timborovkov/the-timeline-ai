import * as Sentry from '@sentry/node';
import { scrubSentryRequestEvent } from '@timeline/shared/monitoring/sentry-scrub';
import { UnrecoverableError, type Job } from 'bullmq';

function sampleRate(name: string): number {
  const value = Number(process.env[name] ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function isWorkerSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN && process.env.SENTRY_DSN !== 'undefined');
}

export function initWorkerSentry(): boolean {
  if (!isWorkerSentryConfigured()) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: sampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    profilesSampleRate: sampleRate('SENTRY_PROFILES_SAMPLE_RATE'),
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubSentryRequestEvent(event);
    },
  });
  Sentry.setTag('component', 'worker');
  return true;
}

export function captureWorkerException(
  err: unknown,
  tags: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (!isWorkerSentryConfigured()) return;
  Sentry.withScope((scope) => {
    Object.entries(tags).forEach(([key, value]) => {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    });
    Sentry.captureException(err);
  });
}

function shouldCaptureWorkerJobFailure(
  job: Pick<Job, 'attemptsMade' | 'opts'> | undefined,
  err: unknown,
): boolean {
  if (err instanceof UnrecoverableError) return true;
  if (!job) return true;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

function isTerminalWorkerJobFailure(
  job: Pick<Job, 'attemptsMade' | 'opts'> | undefined,
  err: unknown,
): boolean {
  return shouldCaptureWorkerJobFailure(job, err);
}

export function captureWorkerJobFailure(
  err: unknown,
  job: Pick<Job, 'id' | 'name' | 'queueName' | 'attemptsMade' | 'opts'> | undefined,
  tags: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const terminal = isTerminalWorkerJobFailure(job, err);
  captureWorkerException(err, {
    component: 'worker_job',
    queueName: job?.queueName,
    jobName: job?.name,
    jobId: job?.id,
    attemptsMade: job?.attemptsMade,
    maxAttempts: job?.opts.attempts ?? 1,
    terminal,
    unrecoverable: err instanceof UnrecoverableError,
    ...tags,
  });
}

export async function flushWorkerSentry(timeoutMs = 2000): Promise<boolean> {
  if (!isWorkerSentryConfigured()) return true;
  return Sentry.flush(timeoutMs);
}

export const workerSentryInternals = { sampleRate };
