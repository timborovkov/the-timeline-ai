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
  // Use rawEventId as the BullMQ job id so a retried Telegram webhook (which
  // is already idempotent at the row level via ON CONFLICT DO NOTHING) can
  // also not double-enqueue if the producer is invoked twice.
  await getTranscribeQueue().add('transcribe', data, { jobId: data.rawEventId });
}

export async function closeTranscribeQueue(): Promise<void> {
  if (!_transcribeQueue) return;
  const q = _transcribeQueue;
  _transcribeQueue = undefined;
  await q.close().catch(() => undefined);
}
