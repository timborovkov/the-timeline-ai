import * as Sentry from '@sentry/nextjs';

type SentryTagValue = string | number | boolean | null | undefined;

interface ReportOptions {
  surface: 'api' | 'server_action' | 'background' | 'render' | 'layout';
  operation: string;
  level?: 'fatal' | 'error' | 'warning';
  tags?: Record<string, SentryTagValue>;
}

interface ReportMessageOptions extends ReportOptions {
  message: string;
}

const HANDLED_EVENT_WINDOW_MS = 60_000;
const HANDLED_EVENT_MAX_PER_WINDOW = 10;

const handledEventBuckets = new Map<
  string,
  { count: number; suppressed: number; windowStart: number }
>();

export function shouldReportToSentry(
  err: unknown,
  options?: Pick<ReportOptions, 'surface' | 'operation'>,
): boolean {
  if (isExpectedAuthCredentialsSigninError(err, options)) return false;
  return true;
}

export function reportCaughtError(err: unknown, options: ReportOptions): void {
  if (isExpectedAuthCredentialsSigninError(err, options)) {
    reportHandledEvent({
      message: 'auth_credentials_signin_failed',
      surface: options.surface,
      operation: options.operation,
      tags: { reason: 'invalid_credentials' },
    });
    return;
  }
  if (!shouldReportToSentry(err, options)) return;
  Sentry.captureException(err, {
    level: options.level ?? 'error',
    tags: {
      surface: options.surface,
      operation: options.operation,
      ...aiErrorTags(err),
      ...stringifyTags(options.tags),
    },
  });
}

export function reportHandledEvent(options: ReportMessageOptions): void {
  const tags = {
    surface: options.surface,
    operation: options.operation,
    ...stringifyTags(options.tags),
  };
  const throttle = handledEventThrottle(options.message, tags, Date.now());
  if (!throttle.capture) return;
  Sentry.captureMessage(options.message, {
    level: options.level ?? 'warning',
    tags: {
      ...tags,
      ...throttle.tags,
    },
  });
}

export function resetHandledEventThrottleForTests(): void {
  handledEventBuckets.clear();
}

function stringifyTags(tags: Record<string, SentryTagValue> | undefined): Record<string, string> {
  if (!tags) return {};
  return Object.fromEntries(
    Object.entries(tags)
      .filter((entry): entry is [string, Exclude<SentryTagValue, null | undefined>] => {
        const [, value] = entry;
        return value !== undefined && value !== null;
      })
      .map(([key, value]) => [key, String(value)]),
  );
}

function handledEventThrottle(
  message: string,
  tags: Record<string, string>,
  now: number,
): { capture: boolean; tags: Record<string, string> } {
  const key = handledEventKey(message, tags);
  const bucket = handledEventBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= HANDLED_EVENT_WINDOW_MS) {
    handledEventBuckets.set(key, { count: 1, suppressed: 0, windowStart: now });
    return bucket?.suppressed
      ? { capture: true, tags: { suppressedCount: String(bucket.suppressed) } }
      : { capture: true, tags: {} };
  }
  if (bucket.count < HANDLED_EVENT_MAX_PER_WINDOW) {
    bucket.count += 1;
    return { capture: true, tags: {} };
  }
  bucket.suppressed += 1;
  return { capture: false, tags: {} };
}

function handledEventKey(message: string, tags: Record<string, string>): string {
  return JSON.stringify({
    message,
    surface: tags.surface,
    operation: tags.operation,
    reason: tags.reason,
  });
}

function aiErrorTags(err: unknown): Record<string, string> {
  if (!err || typeof err !== 'object') return {};
  const row = err as { timelineAi?: unknown; operation?: unknown; model?: unknown };
  if (row.timelineAi !== true) return {};
  return stringifyTags({
    aiOperation: typeof row.operation === 'string' ? row.operation : undefined,
    aiModel: typeof row.model === 'string' ? row.model : undefined,
  });
}

function isExpectedAuthCredentialsSigninError(
  err: unknown,
  options: Pick<ReportOptions, 'surface' | 'operation'> | undefined,
): boolean {
  if (!err || typeof err !== 'object') return false;
  return (
    (err as { type?: unknown }).type === 'CredentialsSignin' &&
    (err as { code?: unknown }).code === 'credentials' &&
    options?.surface === 'server_action' &&
    options.operation === 'sign_in'
  );
}
