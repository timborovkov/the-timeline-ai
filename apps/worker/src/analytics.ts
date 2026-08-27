import {
  capturePostHogProductEvent,
  reviewedPostHogHost,
  REVIEWED_POSTHOG_EU_ORIGIN,
  type AnalyticsActor,
  type ProductEventName,
  type ProductEventPayloads,
} from '@timeline/shared/analytics/posthog-node';

function nonEmpty(value: string | undefined): string | undefined {
  return value && value !== 'undefined' ? value : undefined;
}

function posthogConfig() {
  const configuredHost = nonEmpty(process.env.POSTHOG_HOST);
  const host = configuredHost ? reviewedPostHogHost(configuredHost) : REVIEWED_POSTHOG_EU_ORIGIN;
  const pseudonymizationKey = nonEmpty(process.env.ANALYTICS_PSEUDONYMIZATION_KEY);
  return {
    key: host ? nonEmpty(process.env.POSTHOG_PROJECT_KEY) : undefined,
    host: host ?? REVIEWED_POSTHOG_EU_ORIGIN,
    ...(pseudonymizationKey ? { pseudonymizationKey } : {}),
  };
}

async function trackProductEvent<Name extends ProductEventName>(
  actor: AnalyticsActor,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  await capturePostHogProductEvent(posthogConfig(), actor, event, properties);
}

export function trackProductEventBestEffort<Name extends ProductEventName>(
  actor: AnalyticsActor,
  event: Name,
  properties: ProductEventPayloads[Name],
): void {
  void trackProductEvent(actor, event, properties).catch(() => undefined);
}
