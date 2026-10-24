const SENSITIVE_PATH_PREDECESSORS = new Set(['accept-invite', 'verify-email']);
const BREADCRUMB_URL_FIELD = /^(?:from|href|request_?url|to|uri|url)$/i;
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

export interface SentrySpanLike {
  name?: string;
  attributes?: Record<string, unknown>;
}

const SPAN_DROP_ATTRIBUTE_KEY =
  /(?:^|\.)(?:headers?|cookies?|query(?:string)?|authorization|referer|referrer|user[-_]?agent|forwarded|x-forwarded)(?:$|\.)/i;
const SPAN_URL_ATTRIBUTE_KEY =
  /^(?:url(?:\.(?:full|path|original|fragment))?|http\.(?:url|target|route|request\.url|request\.path)|url\.path)$/i;
const HTTP_SPAN_NAME_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i;

export function scrubSentryRequestEvent<Event extends SentryEventLike>(event: Event): Event {
  if (event.request) {
    const sanitizedUrl = sanitizeRequestUrl(event.request.url);
    if (sanitizedUrl !== undefined) event.request.url = sanitizedUrl;
    delete event.request.cookies;
    // Request headers are not needed to diagnose application failures. A
    // denylist cannot anticipate Referer tokens, forwarded IPs, or custom
    // secret headers, so fail closed and remove the complete map.
    delete event.request.headers;
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

export function sanitizeSpanName(name: string): string {
  const match = HTTP_SPAN_NAME_RE.exec(name);
  if (match?.[1] && match[2]) {
    return `${match[1].toUpperCase()} ${sanitizeRequestUrl(match[2]) ?? match[2]}`;
  }
  return sanitizeRequestUrl(name) ?? name;
}

export function scrubSentrySpan<Span extends SentrySpanLike>(span: Span): Span {
  if (typeof span.name === 'string') span.name = sanitizeSpanName(span.name);
  if (!span.attributes) return span;

  span.attributes = Object.fromEntries(
    Object.entries(span.attributes).flatMap(([key, value]) => {
      if (SPAN_DROP_ATTRIBUTE_KEY.test(key)) return [];
      if (typeof value !== 'string') return [[key, value]];
      const redacted = redactTelegramBotTokenInUrl(value);
      if (SPAN_URL_ATTRIBUTE_KEY.test(key) || looksLikeUrl(redacted)) {
        return [[key, sanitizeRequestUrl(redacted) ?? redacted]];
      }
      return [[key, redacted]];
    }),
  );
  return span;
}

function looksLikeUrl(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value) || value.startsWith('/');
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
      Object.entries(next.data).map(([key, value]) => {
        if (typeof value !== 'string') return [key, value];
        const redacted = redactTelegramBotTokenInUrl(value);
        return [key, BREADCRUMB_URL_FIELD.test(key) ? sanitizeRequestUrl(redacted) : redacted];
      }),
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
