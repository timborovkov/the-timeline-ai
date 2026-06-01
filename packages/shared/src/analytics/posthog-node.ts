import { PostHog } from 'posthog-node';

import {
  FEATURE_FLAGS,
  type FeatureFlagName,
  type ProductEventName,
  type ProductEventPayloads,
} from '#src/analytics/events.js';

export interface PostHogNodeConfig {
  key: string | undefined;
  host: string;
}

export type { FeatureFlagName, ProductEventName, ProductEventPayloads };

function createClient(config: PostHogNodeConfig): PostHog | null {
  if (!config.key || config.key === 'undefined') return null;
  return new PostHog(config.key, {
    host: config.host,
    flushAt: 1,
    flushInterval: 0,
  });
}

export async function capturePostHogProductEvent<Name extends ProductEventName>(
  config: PostHogNodeConfig,
  distinctId: string,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  const client = createClient(config);
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

export async function evaluatePostHogFeatureFlag(
  config: PostHogNodeConfig,
  flag: FeatureFlagName,
  distinctId: string,
): Promise<boolean | string | undefined> {
  const client = createClient(config);
  if (!client) return undefined;
  try {
    const key = FEATURE_FLAGS[flag].key;
    const flags = await client.evaluateFlags(distinctId, { flagKeys: [key] });
    return flags.getFlag(key) ?? undefined;
  } finally {
    await client.shutdown();
  }
}
