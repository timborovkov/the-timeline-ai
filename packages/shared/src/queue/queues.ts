import { Queue } from 'bullmq';

import { getRedisConnection } from './connection';

export const QUEUE_NAMES = {
  transcribe: 'transcribe',
  // Phase 4/5 consumers — names reserved here so producers compile cleanly.
  // No worker process is started for these until those phases land.
  extract: 'extract',
  embed: 'embed',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface TranscribeJobData {
  rawEventId: string;
  teamId: string;
  audioKey: string;
}

let _transcribeQueue: Queue<TranscribeJobData> | undefined;

export function getTranscribeQueue(): Queue<TranscribeJobData> {
  if (_transcribeQueue) return _transcribeQueue;
  _transcribeQueue = new Queue<TranscribeJobData>(QUEUE_NAMES.transcribe, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _transcribeQueue;
}

export async function enqueueTranscribeJob(data: TranscribeJobData): Promise<void> {
  // Intentionally NO jobId-based dedup. BullMQ blocks re-adds for any
  // existing job, including ones already in the failed-and-retained state
  // (`removeOnFail: { age: ... }`). That breaks two important paths:
  //   1. The Telegram webhook self-heal — when the prior job exhausted its
  //      retries and is still in failed state, the next retry would be
  //      silently dropped.
  //   2. A future reconciler that re-enqueues audio rows with no transcript
  //      would hit the same wall.
  // Idempotency lives at two other layers, which is enough:
  //   - The raw_events row is unique per Telegram update (partial unique
  //     index on tg_update_id), so the same physical message can produce
  //     at most one row.
  //   - The worker's UPDATE on raw_events.content_text is deterministic in
  //     audio bytes, so a duplicate job overwrites with the same value.
  // The only real cost of an accidental duplicate enqueue is one extra
  // OpenRouter call. Acceptable.
  await getTranscribeQueue().add('transcribe', data);
}

export async function closeTranscribeQueue(): Promise<void> {
  if (!_transcribeQueue) return;
  const q = _transcribeQueue;
  _transcribeQueue = undefined;
  await q.close().catch(() => undefined);
}
