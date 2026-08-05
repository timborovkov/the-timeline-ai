const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-auth-token']);
const SENSITIVE_PATH_PREDECESSORS = new Set(['accept-invite']);
/** Telegram Bot API embeds the bot token in the URL path (`/bot<token>/method`). */
const TELEGRAM_BOT_TOKEN_IN_URL_RE = /(?:https?:\/\/)?api\.telegram\.org\/bot[^/\s"'\\?#]+/gi;

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
    return `${hasScheme ? 'https://' : ''}api.telegram.org/bot[redacted]`;
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
