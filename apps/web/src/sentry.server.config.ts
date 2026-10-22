import * as Sentry from '@sentry/nextjs';
import { RESTRICTED_SENTRY_DATA_COLLECTION } from '@timeline/shared/monitoring/sentry-scrub';

import { scrubSentryBreadcrumbEvent, scrubSentryEvent, sentrySampleRate } from '@/sentry.shared';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    profilesSampleRate: sentrySampleRate('SENTRY_PROFILES_SAMPLE_RATE'),
    dataCollection: RESTRICTED_SENTRY_DATA_COLLECTION,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumbEvent,
  });
}
