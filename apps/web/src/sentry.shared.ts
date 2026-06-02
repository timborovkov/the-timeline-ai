import {
  sanitizeRequestUrl,
  scrubSentryRequestEvent,
} from '@timeline/shared/monitoring/sentry-scrub';

import type { ErrorEvent, EventHint } from '@sentry/nextjs';

export { sanitizeRequestUrl };

export function sentrySampleRate(name: string): number {
  return parseSentrySampleRate(process.env[name]);
}

export function parseSentrySampleRate(raw: string | number | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  return scrubSentryRequestEvent(event);
}
