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

export function shouldReportToSentry(err: unknown): boolean {
  void err;
  return true;
}

export function reportCaughtError(err: unknown, options: ReportOptions): void {
  if (!shouldReportToSentry(err)) return;
  Sentry.captureException(err, {
    level: options.level ?? 'error',
    tags: {
      surface: options.surface,
      operation: options.operation,
      ...stringifyTags(options.tags),
    },
  });
}

export function reportHandledEvent(options: ReportMessageOptions): void {
  Sentry.captureMessage(options.message, {
    level: options.level ?? 'warning',
    tags: {
      surface: options.surface,
      operation: options.operation,
      ...stringifyTags(options.tags),
    },
  });
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
