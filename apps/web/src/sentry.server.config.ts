import * as Sentry from '@sentry/nextjs';
import { stampSentryRuntimeContext } from '@timeline/shared/monitoring/sentry-runtime';
import { RESTRICTED_SENTRY_DATA_COLLECTION } from '@timeline/shared/monitoring/sentry-scrub';

import {
  scrubSentryBreadcrumbEvent,
  scrubSentryEvent,
  scrubSentrySpanEvent,
  sentrySampleRate,
} from '@/sentry.shared';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: sentrySampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    dataCollection: RESTRICTED_SENTRY_DATA_COLLECTION,
    beforeSend(event, hint) {
      const scrubbed = scrubSentryEvent(event, hint);
      if (!scrubbed) return null;
      return stampSentryRuntimeContext(scrubbed);
    },
    beforeSendSpan: scrubSentrySpanEvent,
    beforeBreadcrumb: scrubSentryBreadcrumbEvent,
  });
}
