import type { ErrorEvent, EventHint } from '@sentry/nextjs';

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-auth-token']);
const SENSITIVE_PATH_PREDECESSORS = new Set(['accept-invite']);

export function sentrySampleRate(name: string): number {
  return parseSentrySampleRate(process.env[name]);
}

export function parseSentrySampleRate(raw: string | number | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
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
}

export function sanitizeRequestUrl(rawUrl: string | undefined): string | undefined {
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
