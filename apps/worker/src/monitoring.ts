import * as Sentry from '@sentry/node';

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-auth-token']);
const SENSITIVE_PATH_PREDECESSORS = new Set(['accept-invite']);

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
      if (event.request) {
        const sanitizedUrl = sanitizeRequestUrl(event.request.url);
        if (sanitizedUrl !== undefined) event.request.url = sanitizedUrl;
        delete event.request.cookies;
        if (event.request.headers) {
          event.request.headers = Object.fromEntries(
            Object.entries(event.request.headers).filter(
              ([key]) => !SENSITIVE_HEADER_NAMES.has(key.toLowerCase()),
            ),
          );
        }
      }
      return event;
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

function sanitizeRequestUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(rawUrl);

  try {
    const url = new URL(rawUrl, 'https://timeline.local');
    url.search = '';
    url.hash = '';
    url.pathname = redactSensitivePath(url.pathname);
    return hasScheme ? url.toString() : url.pathname;
  } catch {
    return redactSensitivePath(rawUrl.split(/[?#]/, 1)[0] ?? rawUrl);
  }
}

function redactSensitivePath(pathname: string): string {
  const parts = pathname.split('/');
  return parts
    .map((part, index) => {
      const previous = parts[index - 1]?.toLowerCase();
      return part && previous && SENSITIVE_PATH_PREDECESSORS.has(previous) ? '[redacted]' : part;
    })
    .join('/');
}
