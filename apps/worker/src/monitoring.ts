import * as Sentry from '@sentry/node';
import { scrubSentryRequestEvent } from '@timeline/shared/monitoring/sentry-scrub';

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

export async function flushWorkerSentry(timeoutMs = 2000): Promise<boolean> {
  if (!isWorkerSentryConfigured()) return true;
  return Sentry.flush(timeoutMs);
}

export const workerSentryInternals = { sampleRate };
