import * as Sentry from '@sentry/nextjs';

import {
  parseSentrySampleRate,
  scrubSentryBreadcrumbEvent,
  scrubSentryEvent,
} from '@/sentry.shared';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = parseSentrySampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);
const profilesSampleRate = parseSentrySampleRate(
  process.env.NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
);

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate,
    profilesSampleRate,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumbEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
