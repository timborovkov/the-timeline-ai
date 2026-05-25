// Phase 10 — Meeting bots. One factory; provider tag drives backend choice.

import { getEnv } from '../env.js';

import { createRecallProvider } from './recall.js';

import type { MeetingBotProvider } from './types.js';

export * from './types.js';
export { createRecallProvider, recallMapStatus } from './recall.js';
export { verifySvixSignature, type SvixVerifyResult } from './svix.js';

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

/** True if the configured environment has enough to start a bot. */
export function isMeetingBotConfigured(): boolean {
  const env = getEnv();
  return Boolean(
    env.RECALL_API_KEY && env.RECALL_TRANSCRIPT_WEBHOOK_URL && env.RECALL_STATUS_WEBHOOK_SECRET,
  );
}

/** Test-only reset of the cached provider. */
export function resetMeetingBotProviderForTests(): void {
  _cached = undefined;
}
