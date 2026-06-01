import type { ErrorEvent, EventHint } from '@sentry/nextjs';

export function sentrySampleRate(name: string): number {
  const value = Number(process.env[name] ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers['x-auth-token'];
    }
  }
  return event;
}
