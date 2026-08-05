import * as Sentry from '@sentry/node';
import {
  scrubSentryBreadcrumb,
  scrubSentryRequestEvent,
} from '@timeline/shared/monitoring/sentry-scrub';
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
    beforeBreadcrumb(breadcrumb) {
      return scrubSentryBreadcrumb(breadcrumb);
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
    const aiError = aiErrorDetails(err);
    Object.entries({ ...aiError.tags, ...tags }).forEach(([key, value]) => {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    });
    if (aiError.context) scope.setContext('ai', aiError.context);
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

function aiErrorDetails(err: unknown): {
  tags: Record<string, string>;
  context: Record<string, string> | null;
} {
  if (!err || typeof err !== 'object') return { tags: {}, context: null };
  const row = err as {
    timelineAi?: unknown;
    operation?: unknown;
    model?: unknown;
    causeName?: unknown;
    causeMessage?: unknown;
  };
  if (row.timelineAi !== true) return { tags: {}, context: null };
  const tags = Object.fromEntries(
    Object.entries({
      aiOperation: typeof row.operation === 'string' ? row.operation : undefined,
      aiModel: typeof row.model === 'string' ? row.model : undefined,
      aiCauseName: typeof row.causeName === 'string' ? row.causeName : undefined,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const context =
    typeof row.causeMessage === 'string'
      ? {
          causeMessage: row.causeMessage,
        }
      : null;
  return { tags, context };
}
