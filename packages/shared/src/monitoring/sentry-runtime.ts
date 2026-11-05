export interface SentryRuntimeContext {
  name?: string;
  version?: string;
}

export interface SentryRuntimeEventLike {
  contexts?: {
    runtime?: SentryRuntimeContext;
    [key: string]: unknown;
  };
}

/**
 * `@sentry/node` and `@sentry/nextjs` report Bun as Node 26.3.0 compatibility.
 * Keep this helper off the Edge/browser graphs — they import sentry-scrub only.
 */
export function stampSentryRuntimeContext<Event extends SentryRuntimeEventLike>(
  event: Event,
): Event {
  const bunVersion = process.versions.bun;
  if (typeof bunVersion !== 'string' || bunVersion.length === 0) return event;
  event.contexts = {
    ...event.contexts,
    runtime: {
      name: 'bun',
      version: bunVersion,
    },
  };
  return event;
}
