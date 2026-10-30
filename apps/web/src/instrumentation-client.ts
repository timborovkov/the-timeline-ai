import * as Sentry from '@sentry/nextjs';
import { RESTRICTED_SENTRY_DATA_COLLECTION } from '@timeline/shared/monitoring/sentry-scrub';

import {
  parseSentrySampleRate,
  scrubSentryBreadcrumbEvent,
  scrubSentryEvent,
  scrubSentrySpanEvent,
} from '@/sentry.shared';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const tracesSampleRate = parseSentrySampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE);

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate,
    tunnel: '/sentry-tunnel',
    dataCollection: RESTRICTED_SENTRY_DATA_COLLECTION,
    beforeSend: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpanEvent,
    beforeBreadcrumb: scrubSentryBreadcrumbEvent,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
