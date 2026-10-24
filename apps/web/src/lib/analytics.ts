import {
  capturePostHogPersonlessSurfaceRequest,
  capturePostHogProductEvent,
  reviewedPostHogHost,
  REVIEWED_POSTHOG_EU_ORIGIN,
  type AnalyticsActor,
  type AppSurface,
  type ProductEventName,
  type ProductEventPayloads,
  type PublicSurface,
} from '@timeline/shared/analytics/posthog-node';
import { after } from 'next/server';

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

export async function trackProductEvent<Name extends ProductEventName>(
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
  const capture = trackProductEvent(actor, event, properties).catch(() => undefined);
  try {
    after(capture);
  } catch {
    // Workers and tests may call the shared helper outside a Next.js request.
    // The already-started, failure-swallowing capture remains best effort there.
  }
}

export function capturePersonlessSurfaceRequest(
  stream: 'public',
  surface: PublicSurface,
): Promise<void>;
export function capturePersonlessSurfaceRequest(stream: 'app', surface: AppSurface): Promise<void>;
export function capturePersonlessSurfaceRequest(
  stream: 'public' | 'app',
  surface: PublicSurface | AppSurface,
): Promise<void> {
  return stream === 'public'
    ? capturePostHogPersonlessSurfaceRequest(posthogConfig(), 'public', surface as PublicSurface)
    : capturePostHogPersonlessSurfaceRequest(posthogConfig(), 'app', surface as AppSurface);
}
