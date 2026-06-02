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

const clients = new Map<string, PostHog>();
let processShutdownRegistered = false;

function clientCacheKey(config: Required<PostHogNodeConfig>): string {
  return `${config.host}\0${config.key}`;
}

function getClient(config: PostHogNodeConfig): PostHog | null {
  if (!config.key || config.key === 'undefined') return null;
  const cacheableConfig = { key: config.key, host: config.host };
  const cacheKey = clientCacheKey(cacheableConfig);
  const existing = clients.get(cacheKey);
  if (existing) return existing;

  const client = new PostHog(config.key, {
    host: config.host,
    flushAt: 1,
    flushInterval: 0,
  });
  clients.set(cacheKey, client);
  registerProcessShutdown();
  return client;
}

function registerProcessShutdown(): void {
  if (processShutdownRegistered) return;
  processShutdownRegistered = true;
  process.once('beforeExit', () => {
    void shutdownPostHogNodeClients();
  });
}

export async function shutdownPostHogNodeClients(): Promise<void> {
  const cachedClients = [...clients.values()];
  clients.clear();
  await Promise.all(cachedClients.map((client) => client.shutdown()));
}

export function capturePostHogProductEvent<Name extends ProductEventName>(
  config: PostHogNodeConfig,
  distinctId: string,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  const client = getClient(config);
  if (!client) return Promise.resolve();
  const message = {
    distinctId,
    event,
    properties,
    sendFeatureFlags: true,
    ...('teamId' in properties ? { groups: { team: properties.teamId } } : {}),
  };
  client.capture(message);
  return Promise.resolve();
}

export async function evaluatePostHogFeatureFlag(
  config: PostHogNodeConfig,
  flag: FeatureFlagName,
  distinctId: string,
): Promise<boolean | string | undefined> {
  const client = getClient(config);
  if (!client) return undefined;
  const key = FEATURE_FLAGS[flag].key;
  const flags = await client.evaluateFlags(distinctId, { flagKeys: [key] });
  return flags.getFlag(key) ?? undefined;
}
