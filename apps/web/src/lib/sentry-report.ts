import * as Sentry from '@sentry/nextjs';

type SentryTagValue = string | number | boolean | null | undefined;

interface ReportOptions {
  surface: 'api' | 'server_action' | 'background' | 'render' | 'layout';
  operation: string;
  level?: 'fatal' | 'error' | 'warning';
  tags?: Record<string, SentryTagValue>;
}

const EXPECTED_ERROR_MESSAGES = new Set([
  'invalid',
  'wrong-account',
  'already-member',
  'last_owner',
  'not_found',
  'invalid_recovery_id',
  'stale_recovery_set',
  'invalid_recovery_ids',
]);

export function shouldReportToSentry(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (EXPECTED_ERROR_MESSAGES.has(err.message)) return false;
  const digest = (err as Error & { digest?: string }).digest;
  if (digest?.startsWith('NEXT_REDIRECT') || digest?.startsWith('NEXT_NOT_FOUND')) return false;
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
