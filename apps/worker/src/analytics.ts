import {
  capturePostHogProductEvent,
  type ProductEventName,
  type ProductEventPayloads,
} from '@timeline/shared/analytics/posthog-node';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

function posthogHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return host === undefined || host.length === 0 ? DEFAULT_HOST : host;
}

function posthogKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key !== 'undefined' ? key : undefined;
}

function posthogConfig() {
  return { key: posthogKey(), host: posthogHost() };
}

async function trackProductEvent<Name extends ProductEventName>(
  distinctId: string,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  await capturePostHogProductEvent(posthogConfig(), distinctId, event, properties);
}

export function trackProductEventBestEffort<Name extends ProductEventName>(
  distinctId: string,
  event: Name,
  properties: ProductEventPayloads[Name],
): void {
  void trackProductEvent(distinctId, event, properties).catch(() => undefined);
}
