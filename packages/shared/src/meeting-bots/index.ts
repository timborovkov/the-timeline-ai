// Phase 10 — Meeting bots. One factory; provider tag drives backend choice.

import type { MeetingBotProvider } from '#src/meeting-bots/types.js';

import { getEnv } from '#src/env.js';
import { createRecallProvider } from '#src/meeting-bots/recall.js';

export * from '#src/meeting-bots/types.js';
export { createRecallProvider, recallMapStatus } from '#src/meeting-bots/recall.js';
export { verifySvixSignature, type SvixVerifyResult } from '#src/meeting-bots/svix.js';

let _cached: MeetingBotProvider | undefined;

/**
 * Resolve the configured provider. Today only Recall.ai is implemented.
 * `provider` arg lets server actions pin to a specific provider (e.g. when
 * a meeting was scheduled before a global swap).
 */
export function getMeetingBotProvider(provider = 'recall'): MeetingBotProvider {
  if (provider !== 'recall') {
    throw new Error(`Unknown meeting bot provider: ${provider}`);
  }
  if (_cached?.name === provider) return _cached;
  _cached = createRecallProvider();
  return _cached;
}

/**
 * Resolve the URL Recall posts transcript events to. Derived from
 * `AUTH_URL` (the app's public origin — Auth.js requires it to be the
 * publicly-reachable HTTPS endpoint anyway) plus the fixed route path,
 * so most installs need only one env var. `RECALL_TRANSCRIPT_WEBHOOK_URL`
 * remains an explicit override for setups where the webhook should hit a
 * different origin (proxy, tunnel for local dev, separate ingress).
 *
 * The trailing slash on AUTH_URL is normalised so `getAuthUrl() + path`
 * produces the same string regardless of how the operator set it.
 */
export function resolveTranscriptWebhookUrl(): string {
  const env = getEnv();
  if (env.RECALL_TRANSCRIPT_WEBHOOK_URL) return env.RECALL_TRANSCRIPT_WEBHOOK_URL;
  const origin = env.AUTH_URL.replace(/\/$/, '');
  return `${origin}/api/webhooks/recall/transcript`;
}

/** True if the configured environment has enough to start a bot. */
export function isMeetingBotConfigured(): boolean {
  const env = getEnv();
  // AUTH_URL is required by the schema, so resolveTranscriptWebhookUrl
  // always produces a value — the only thing that can be missing is the
  // Recall API key + status secret.
  return Boolean(env.RECALL_API_KEY && env.RECALL_STATUS_WEBHOOK_SECRET);
}

/** Test-only reset of the cached provider. */
export function resetMeetingBotProviderForTests(): void {
  _cached = undefined;
}
