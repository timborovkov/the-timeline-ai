import * as Sentry from '@sentry/nextjs';

import { scrubSentryEvent, sentrySampleRate } from '@/sentry.shared';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    profilesSampleRate: sentrySampleRate('SENTRY_PROFILES_SAMPLE_RATE'),
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
