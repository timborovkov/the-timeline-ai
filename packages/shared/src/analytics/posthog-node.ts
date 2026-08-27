import { createHmac } from 'node:crypto';

import { PostHog } from 'posthog-node';

import {
  type AnalyticsActor,
  type AppSurface,
  type ProductEventName,
  type ProductEventPayloads,
  type PublicSurface,
  validateAnalyticsActor,
  validatePersonlessSurface,
  validateProductEventProperties,
} from '#src/analytics/events.js';
import { childLogger } from '#src/logger.js';

export interface PostHogNodeConfig {
  key: string | undefined;
  host: string;
  pseudonymizationKey?: string;
}

export type { AnalyticsActor, AppSurface, ProductEventName, ProductEventPayloads, PublicSurface };

export const PERSONLESS_STREAM_IDS = {
  public: '__timeline_personless__:public:v1',
  app: '__timeline_personless__:app:v1',
} as const;
export const REVIEWED_POSTHOG_EU_ORIGIN = 'https://eu.i.posthog.com';

const log = childLogger('analytics:posthog');
const clients = new Map<string, PostHog>();
let processShutdownRegistered = false;
let missingPseudonymizationKeyLogged = false;

function clientCacheKey(config: Required<Pick<PostHogNodeConfig, 'key' | 'host'>>): string {
  return `${config.host}\0${config.key}`;
}

export function reviewedPostHogHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.origin === REVIEWED_POSTHOG_EU_ORIGIN
      ? REVIEWED_POSTHOG_EU_ORIGIN
      : undefined;
  } catch {
    return undefined;
  }
}

function getClient(config: PostHogNodeConfig): PostHog | null {
  if (!config.key || config.key === 'undefined') return null;
  const reviewedHost = reviewedPostHogHost(config.host);
  if (!reviewedHost) return null;
  const cacheableConfig = { key: config.key, host: reviewedHost };
  const cacheKey = clientCacheKey(cacheableConfig);
  const existing = clients.get(cacheKey);
  if (existing) return existing;

  const client = new PostHog(config.key, {
    host: reviewedHost,
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
    personProfiles: 'never',
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

export function pseudonymizeAnalyticsId(key: string, kind: 'user' | 'team', rawId: string): string {
  const digest = createHmac('sha256', key).update(`${kind}\0${rawId}`).digest('base64url');
  return `${kind}_${digest}`;
}

function pseudonymousActor(
  config: PostHogNodeConfig,
  input: AnalyticsActor,
): { distinctId: string; teamKey?: string } | null {
  const actor = validateAnalyticsActor(input);
  const key = config.pseudonymizationKey;
  if (!key || key.length < 32) {
    if (!missingPseudonymizationKeyLogged) {
      missingPseudonymizationKeyLogged = true;
      log.warn(
        'ANALYTICS_PSEUDONYMIZATION_KEY is missing or too short; pseudonymous product events are disabled',
      );
    }
    return null;
  }

  if (actor.kind === 'team') {
    const teamKey = pseudonymizeAnalyticsId(key, 'team', actor.teamId);
    return { distinctId: teamKey, teamKey };
  }

  return {
    distinctId: pseudonymizeAnalyticsId(key, 'user', actor.userId),
    ...(actor.teamId ? { teamKey: pseudonymizeAnalyticsId(key, 'team', actor.teamId) } : {}),
  };
}

export async function capturePostHogProductEvent<Name extends ProductEventName>(
  config: PostHogNodeConfig,
  actor: AnalyticsActor,
  event: Name,
  properties: ProductEventPayloads[Name],
): Promise<void> {
  const validatedProperties = validateProductEventProperties(event, properties);
  const pseudonymous = pseudonymousActor(config, actor);
  if (!pseudonymous) return;
  const client = getClient(config);
  if (!client) return;

  await client.captureImmediate({
    distinctId: pseudonymous.distinctId,
    event,
    disableGeoip: true,
    sendFeatureFlags: false,
    properties: {
      ...validatedProperties,
      ...(pseudonymous.teamKey ? { team_key: pseudonymous.teamKey } : {}),
      $process_person_profile: false,
    },
  });
}

export async function capturePostHogPersonlessSurfaceRequest(
  config: Pick<PostHogNodeConfig, 'key' | 'host'>,
  stream: 'public',
  surface: PublicSurface,
): Promise<void>;
export async function capturePostHogPersonlessSurfaceRequest(
  config: Pick<PostHogNodeConfig, 'key' | 'host'>,
  stream: 'app',
  surface: AppSurface,
): Promise<void>;
export async function capturePostHogPersonlessSurfaceRequest(
  config: Pick<PostHogNodeConfig, 'key' | 'host'>,
  stream: 'public' | 'app',
  surface: PublicSurface | AppSurface,
): Promise<void> {
  const validatedSurface =
    stream === 'public'
      ? validatePersonlessSurface('public', surface)
      : validatePersonlessSurface('app', surface);
  const client = getClient(config);
  if (!client) return;

  await client.captureImmediate({
    distinctId: PERSONLESS_STREAM_IDS[stream],
    event: stream === 'public' ? 'public_surface_requested' : 'app_surface_requested',
    disableGeoip: true,
    sendFeatureFlags: false,
    properties: {
      surface: validatedSurface,
      $process_person_profile: false,
    },
  });
}
