import {
  sanitizeRequestUrl,
  scrubSentryBreadcrumb,
  scrubSentryRequestEvent,
} from '@timeline/shared/monitoring/sentry-scrub';

import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs';

export { sanitizeRequestUrl };

const BROWSER_EXTENSION_FRAME_PREFIXES = [
  'app:///scripts/',
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
];

const METAMASK_ERROR_PATTERNS = [/Failed to connect to MetaMask/i, /MetaMask extension not found/i];

const FORMDATA_PARSE_ERROR_RE = /Failed to parse body as FormData/i;
const MULTIPART_BOUNDARY_CAUSE_RE =
  /(?:no boundary found in multipart body|missing boundary in content-type header|expected boundary)/i;

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
  transaction?: string;
};

export function sentrySampleRate(name: string): number {
  return parseSentrySampleRate(process.env[name]);
}

export function parseSentrySampleRate(raw: string | number | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

export function scrubSentryEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  if (shouldDropBrowserExtensionEvent(event)) return null;
  if (shouldDropMalformedMultipartFormDataEvent(event, hint)) return null;
  return scrubSentryRequestEvent(event);
}

export function scrubSentryBreadcrumbEvent(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubSentryBreadcrumb(breadcrumb);
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

/**
 * Drop Next.js noise from scanner/malformed multipart POSTs that never reach
 * app code. Keep FormData parse failures on real routes — those can still
 * indicate broken uploads or Server Action skew.
 */
export function shouldDropMalformedMultipartFormDataEvent(
  event: ErrorEvent,
  hint?: EventHint,
): boolean {
  const parsed = event as ErrorEventWithExceptions;
  const exceptionValues = parsed.exception?.values ?? [];
  const messages = [
    parsed.message,
    parsed.logentry?.message,
    ...exceptionValues.map((value) => value.value),
  ].filter((value): value is string => Boolean(value));

  if (!messages.some((message) => FORMDATA_PARSE_ERROR_RE.test(message))) {
    return false;
  }

  const transaction = parsed.transaction ?? '';
  if (transaction.includes('_not-found')) return true;

  const causeMessage = readErrorCauseMessage(hint?.originalException);
  return Boolean(causeMessage && MULTIPART_BOUNDARY_CAUSE_RE.test(causeMessage));
}

function readErrorCauseMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const cause = 'cause' in error ? error.cause : null;
  if (!cause || typeof cause !== 'object') return null;
  if (!('message' in cause) || typeof cause.message !== 'string') return null;
  return cause.message;
}

function isBrowserExtensionFrame(frame: StackFrameLike): boolean {
  const path = frame.filename ?? frame.abs_path ?? '';
  return BROWSER_EXTENSION_FRAME_PREFIXES.some((prefix) => path.startsWith(prefix));
}
