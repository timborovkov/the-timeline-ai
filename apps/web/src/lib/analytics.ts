import {
  FEATURE_FLAGS,
  type FeatureFlagName,
  type ProductEventName,
  type ProductEventPayloads,
} from '@timeline/shared/analytics';
import { PostHog } from 'posthog-node';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

function posthogKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key && key !== 'undefined' ? key : undefined;
}

function posthogHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST;
}

function createClient(): PostHog | null {
  const key = posthogKey();
  if (!key) return null;
  return new PostHog(key, {
    host: posthogHost(),
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

export async function getFeatureFlag(
  flag: FeatureFlagName,
  distinctId: string,
): Promise<boolean | string | undefined> {
  const client = createClient();
  if (!client) return undefined;
  try {
    const key = FEATURE_FLAGS[flag].key;
    const flags = await client.evaluateFlags(distinctId, { flagKeys: [key] });
    return flags.getFlag(key) ?? undefined;
  } finally {
    await client.shutdown();
  }
}
