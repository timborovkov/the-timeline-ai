import { PostHog } from 'posthog-node';

import type { ProductEventName, ProductEventPayloads } from '@timeline/shared/analytics';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

function createClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || key === 'undefined') return null;
  return new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
}

export async function trackProductEvent<Name extends ProductEventName>(
  distinctId: string,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  const client = createClient();
  if (!client) return;
  try {
    const message = {
      distinctId,
      event,
      properties,
      sendFeatureFlags: true,
      ...('teamId' in properties ? { groups: { team: properties.teamId } } : {}),
    };
    client.capture(message);
  } finally {
    await client.shutdown();
  }
}
