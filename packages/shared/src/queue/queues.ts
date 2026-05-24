import { Queue } from 'bullmq';

import { getRedisConnection } from './connection.js';

export const QUEUE_NAMES = {
  transcribe: 'transcribe',
  // Phase 4/5 consumers — names reserved here so producers compile cleanly.
  // No worker process is started for these until those phases land.
  extract: 'extract',
  embed: 'embed',
  // Phase 8: hourly scan of overdue tasks + follow_ups. Produced by the
  // worker process itself (BullMQ repeatable on startup); consumed by
  // startOverdueWorker.
  overdueScan: 'overdue-scan',
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

export interface ExtractJobData {
  rawEventId: string;
  teamId: string;
}

let _extractQueue: Queue<ExtractJobData> | undefined;

export function getExtractQueue(): Queue<ExtractJobData> {
  if (_extractQueue) return _extractQueue;
  _extractQueue = new Queue<ExtractJobData>(QUEUE_NAMES.extract, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _extractQueue;
}

export async function enqueueExtractJob(data: ExtractJobData): Promise<void> {
  // Same no-jobId-dedup rationale as transcribe: row-level idempotency lives
  // in the worker, which skips when facts for (rawEventId, modelVersion)
  // already exist. A duplicate enqueue costs at most one extra DB lookup.
  await getExtractQueue().add('extract', data);
}

export async function closeExtractQueue(): Promise<void> {
  if (!_extractQueue) return;
  const q = _extractQueue;
  _extractQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface EmbedJobData {
  rawEventId: string;
  teamId: string;
  /** Embed a specific fact's statement rather than the raw event body. */
  factId?: string;
  /** Optional override used by the re-embed script to write into a new
   *  collection during a model migration. When unset, the worker writes to
   *  `QDRANT_COLLECTION`. */
  targetCollection?: string;
}

let _embedQueue: Queue<EmbedJobData> | undefined;

export function getEmbedQueue(): Queue<EmbedJobData> {
  if (_embedQueue) return _embedQueue;
  _embedQueue = new Queue<EmbedJobData>(QUEUE_NAMES.embed, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _embedQueue;
}

export async function enqueueEmbedJob(data: EmbedJobData): Promise<void> {
  // Same no-jobId-dedup rationale as the other queues. Worker-side idempotency
  // is provided by deterministic Qdrant point ids derived from
  // (scope, sourceId, embedding_model) — duplicate enqueues upsert the same
  // point and cost at most one embedding call.
  await getEmbedQueue().add('embed', data);
}

export async function closeEmbedQueue(): Promise<void> {
  if (!_embedQueue) return;
  const q = _embedQueue;
  _embedQueue = undefined;
  await q.close().catch(() => undefined);
}

export interface OverdueScanJobData {
  /** Empty payload: the scan walks every team's entities in one pass. */
  triggeredAt?: string;
}

let _overdueScanQueue: Queue<OverdueScanJobData> | undefined;

export function getOverdueScanQueue(): Queue<OverdueScanJobData> {
  if (_overdueScanQueue) return _overdueScanQueue;
  _overdueScanQueue = new Queue<OverdueScanJobData>(QUEUE_NAMES.overdueScan, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // One retry — if the scan fails, the next hourly tick will pick up
      // whatever it missed. No exponential backoff to avoid pile-up.
      attempts: 2,
      backoff: { type: 'fixed', delay: 60_000 },
      removeOnComplete: { age: 3600, count: 24 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
  return _overdueScanQueue;
}

/**
 * Register the hourly repeatable. Safe to call on every worker boot — BullMQ
 * keys repeatables by `jobId`, so duplicate calls are no-ops.
 */
export async function scheduleOverdueScan(): Promise<void> {
  await getOverdueScanQueue().add(
    'scan',
    {},
    {
      // Every hour on the hour. The dedup index on notifications keys by
      // (team, user, entity, kind, date) so repeated runs within the same
      // calendar day are no-ops.
      repeat: { pattern: '0 * * * *' },
      jobId: 'overdue-scan-hourly',
    },
  );
}

export async function closeOverdueScanQueue(): Promise<void> {
  if (!_overdueScanQueue) return;
  const q = _overdueScanQueue;
  _overdueScanQueue = undefined;
  await q.close().catch(() => undefined);
}
