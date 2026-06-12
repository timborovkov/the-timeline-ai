import {
  sanitizeRequestUrl,
  scrubSentryRequestEvent,
} from '@timeline/shared/monitoring/sentry-scrub';

import type { ErrorEvent, EventHint } from '@sentry/nextjs';

export { sanitizeRequestUrl };

const BROWSER_EXTENSION_FRAME_PREFIXES = [
  'app:///scripts/',
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
];

const METAMASK_ERROR_PATTERNS = [/Failed to connect to MetaMask/i, /MetaMask extension not found/i];

interface StackFrameLike {
  filename?: string;
  abs_path?: string;
}

interface ExceptionValueLike {
  type?: string;
  value?: string;
  stacktrace?: {
    frames?: StackFrameLike[];
  };
}

type ErrorEventWithExceptions = ErrorEvent & {
  exception?: {
    values?: ExceptionValueLike[];
  };
  message?: string;
  logentry?: {
    message?: string;
  };
};

export function sentrySampleRate(name: string): number {
  return parseSentrySampleRate(process.env[name]);
}

export function parseSentrySampleRate(raw: string | number | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (shouldDropBrowserExtensionEvent(event)) return null;
  return scrubSentryRequestEvent(event);
}

export function shouldDropBrowserExtensionEvent(event: ErrorEvent): boolean {
  const parsed = event as ErrorEventWithExceptions;
  const exceptionValues = parsed.exception?.values ?? [];
  const messages = [
    parsed.message,
    parsed.logentry?.message,
    ...exceptionValues.flatMap((value) => [value.type, value.value]),
  ].filter((value): value is string => Boolean(value));

  if (
    !messages.some((message) => METAMASK_ERROR_PATTERNS.some((pattern) => pattern.test(message)))
  ) {
    return false;
  }

  return exceptionValues.some((value) =>
    value.stacktrace?.frames?.some((frame) => isBrowserExtensionFrame(frame)),
  );
}

function isBrowserExtensionFrame(frame: StackFrameLike): boolean {
  const path = frame.filename ?? frame.abs_path ?? '';
  return BROWSER_EXTENSION_FRAME_PREFIXES.some((prefix) => path.startsWith(prefix));
}
