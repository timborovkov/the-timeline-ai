const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-auth-token']);
const SENSITIVE_PATH_PREDECESSORS = new Set(['accept-invite']);
/**
 * Telegram Bot API embeds the bot token in URL paths:
 * - `https://api.telegram.org/bot<token>/method`
 * - `https://api.telegram.org/file/bot<token>/<path>`
 */
const TELEGRAM_BOT_TOKEN_IN_URL_RE =
  /(?:https?:\/\/)?api\.telegram\.org\/(?:file\/)?bot[^/\s"'\\?#]+/gi;

export interface SentryRequestLike {
  url?: string;
  cookies?: unknown;
  headers?: Record<string, unknown> | undefined;
}

export interface SentryBreadcrumbLike {
  message?: string;
  data?: Record<string, unknown>;
}

export interface SentryEventLike {
  request?: SentryRequestLike;
  breadcrumbs?: SentryBreadcrumbLike[];
}

export function scrubSentryRequestEvent<Event extends SentryEventLike>(event: Event): Event {
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

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);
  }

  return event;
}

export function sanitizeRequestUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  const redactedSecrets = redactTelegramBotTokenInUrl(rawUrl);
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(redactedSecrets);

  try {
    const url = new URL(redactedSecrets, 'https://timeline.local');
    url.search = '';
    url.hash = '';
    url.pathname = redactSensitivePath(url.pathname);
    return hasScheme ? url.toString() : url.pathname;
  } catch {
    return redactSensitivePath(redactedSecrets.split(/[?#]/, 1)[0] ?? redactedSecrets);
  }
}

export function redactTelegramBotTokenInUrl(raw: string): string {
  return raw.replace(TELEGRAM_BOT_TOKEN_IN_URL_RE, (match) => {
    const hasScheme = /^https?:\/\//i.test(match);
    const filePrefix = /api\.telegram\.org\/file\/bot/i.test(match) ? 'file/' : '';
    return `${hasScheme ? 'https://' : ''}api.telegram.org/${filePrefix}bot[redacted]`;
  });
}

export function scrubSentryBreadcrumb<Breadcrumb extends SentryBreadcrumbLike>(
  breadcrumb: Breadcrumb,
): Breadcrumb {
  const next = { ...breadcrumb };
  if (typeof next.message === 'string') {
    next.message = redactTelegramBotTokenInUrl(next.message);
  }
  if (next.data) {
    next.data = Object.fromEntries(
      Object.entries(next.data).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactTelegramBotTokenInUrl(value) : value,
      ]),
    );
  }
  return next;
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

/**
 * Sentry 11 replacement for `sendDefaultPii: false`. v11 collects more by
 * default, so every init must set these categories explicitly. Transaction
 * `profilesSampleRate` was removed in v11; session profiling would need
 * `@sentry/profiling-node` / browser profiling integrations and is left off.
 */
export const RESTRICTED_SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
    response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
  },
  httpBodies: [] as (
    'incomingRequest' | 'outgoingRequest' | 'incomingResponse' | 'outgoingResponse'
  )[],
  urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
  queues: false,
  stackFrameVariables: false,
};
