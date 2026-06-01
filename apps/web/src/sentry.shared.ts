import type { ErrorEvent, EventHint } from '@sentry/nextjs';

const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-auth-token']);

export function sentrySampleRate(name: string): number {
  return parseSentrySampleRate(process.env[name]);
}

export function parseSentrySampleRate(raw: string | number | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  if (event.request) {
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
