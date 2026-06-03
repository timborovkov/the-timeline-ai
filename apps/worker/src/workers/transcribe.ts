import { type Db, rawEvents } from '@timeline/db';
import {
  childLogger,
  getAudioBucket,
  getObjectBuffer,
  getS3Client,
  headObject,
  llm,
  queue,
} from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:transcribe');

// Phase 3 cap: 25 MB. Telegram voice memos are well under this; the web
// recorder doesn't enforce a duration cap (acceptable Phase 3 trade-off),
// but we refuse to read a runaway upload into memory on the worker side.
// When long-form audio lands (Phase 4+), this should be replaced with
// streaming straight from S3 to the transcription provider.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

interface TranscribeWorkerDeps {
  db: Db;
}

export interface TranscribeWorkerIO {
  headObject(input: { audioKey: string }): Promise<{ contentLength?: number | undefined }>;
  getObjectBuffer(input: { audioKey: string; maxBytes: number }): Promise<{ body: Buffer }>;
  transcribeAudio(input: { audio: Buffer }): Promise<{ text: string; model: string }>;
  enqueueExtract(input: queue.ExtractJobData): Promise<void>;
  enqueueEmbed(input: queue.EmbedRawEventJobData): Promise<void>;
  enqueueSuggestion(input: queue.SuggestionJobData): Promise<void>;
}

function defaultIO(): TranscribeWorkerIO {
  const s3 = getS3Client();
  const bucket = getAudioBucket();
  return {
    async headObject(input) {
      return headObject(s3, bucket, input.audioKey);
    },
    async getObjectBuffer(input) {
      return getObjectBuffer(s3, bucket, input.audioKey, input.maxBytes);
    },
    async transcribeAudio(input) {
      return llm.transcribeAudio(input);
    },
    async enqueueExtract(input) {
      await queue.enqueueExtractJob(input);
    },
    async enqueueEmbed(input) {
      await queue.enqueueEmbedJob(input);
    },
    async enqueueSuggestion(input) {
      await queue.enqueueSuggestionJob(input);
    },
  };
}

export async function processTranscribeJobForTests(
  deps: TranscribeWorkerDeps,
  data: queue.TranscribeJobData,
  io: TranscribeWorkerIO = defaultIO(),
): Promise<{ rawEventId: string; model?: string }> {
  const { rawEventId, audioKey } = data;
  const head = await io.headObject({ audioKey });
  if (head.contentLength === undefined) {
    throw new UnrecoverableError(
      `Audio object ${audioKey} has no Content-Length; cannot bounds-check`,
    );
  }
  if (head.contentLength > MAX_AUDIO_BYTES) {
    throw new UnrecoverableError(
      `Audio object ${audioKey} is ${head.contentLength} bytes; max is ${MAX_AUDIO_BYTES}`,
    );
  }
  const { body } = await io.getObjectBuffer({ audioKey, maxBytes: MAX_AUDIO_BYTES });
  const result = await io.transcribeAudio({ audio: body });

  const patch = JSON.stringify({
    transcription_model: result.model,
    transcribed_at: new Date().toISOString(),
  });
  // Clear stale failure markers on success. A row that previously failed
  // (Redis outage, enqueue-failed) then succeeds via retry must not
  // continue to read as failed in the timeline UI.
  const update = await deps.db
    .update(rawEvents)
    .set({
      contentText: result.text,
      sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'transcription_failed_at' - 'transcription_error') || ${patch}::jsonb`,
    })
    .where(eq(rawEvents.id, rawEventId))
    .returning({ id: rawEvents.id, teamId: rawEvents.teamId });
  if (update.length === 0) {
    log.warn({ rawEventId }, 'raw event not found at update');
    return { rawEventId, model: result.model };
  }

  try {
    const row = update[0];
    if (row) {
      await io.enqueueExtract({ rawEventId: row.id, teamId: row.teamId });
    }
  } catch (enqueueErr) {
    log.error({ err: enqueueErr }, 'failed to enqueue extract job');
    captureWorkerException(enqueueErr, {
      component: 'worker_handoff',
      queueName: queue.QUEUE_NAMES.extract,
      operation: 'enqueue_extract_after_transcribe',
    });
    const failurePatch = JSON.stringify({
      extraction_failed_at: new Date().toISOString(),
      extraction_error: `enqueue failed: ${
        enqueueErr instanceof Error ? enqueueErr.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark extract failure');
        captureWorkerException(markErr, {
          component: 'worker_failure_marker',
          operation: 'mark_extract_enqueue_failure',
        });
      });
  }

  try {
    const row = update[0];
    if (row) {
      await io.enqueueEmbed({ rawEventId: row.id, teamId: row.teamId });
    }
  } catch (enqueueErr) {
    log.error({ err: enqueueErr }, 'failed to enqueue embed job');
    captureWorkerException(enqueueErr, {
      component: 'worker_handoff',
      queueName: queue.QUEUE_NAMES.embed,
      operation: 'enqueue_embed_after_transcribe',
    });
    const failurePatch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: `enqueue failed: ${
        enqueueErr instanceof Error ? enqueueErr.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark embed failure');
        captureWorkerException(markErr, {
          component: 'worker_failure_marker',
          operation: 'mark_embed_enqueue_failure',
        });
      });
  }

  try {
    const row = update[0];
    if (row) {
      await io.enqueueSuggestion({ rawEventId: row.id, teamId: row.teamId });
    }
  } catch (enqueueErr) {
    log.error({ err: enqueueErr }, 'failed to enqueue suggestion job');
    captureWorkerException(enqueueErr, {
      component: 'worker_handoff',
      queueName: queue.QUEUE_NAMES.suggestions,
      operation: 'enqueue_suggestion_after_transcribe',
    });
    const failurePatch = JSON.stringify({
      suggestions_failed_at: new Date().toISOString(),
      suggestions_error: `enqueue failed: ${
        enqueueErr instanceof Error ? enqueueErr.message.slice(0, 480) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark suggestion failure');
        captureWorkerException(markErr, {
          component: 'worker_failure_marker',
          operation: 'mark_suggestion_enqueue_failure',
        });
      });
  }
  return { rawEventId, model: result.model };
}

export async function markTranscribeFailureForTests(
  deps: TranscribeWorkerDeps,
  data: Pick<queue.TranscribeJobData, 'rawEventId'>,
  err: Error,
): Promise<void> {
  const patch = JSON.stringify({
    transcription_failed_at: new Date().toISOString(),
    transcription_error: err.message.slice(0, 500),
  });
  await deps.db
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(eq(rawEvents.id, data.rawEventId));
}

/**
 * Transcribe worker: pulls audio from S3, runs OpenRouter transcription,
 * writes the result back onto the raw event.
 *
 * Failure modes worth knowing about:
 *   - `OPENROUTER_API_KEY` unset → `transcribeAudio` throws, BullMQ retries
 *     with exponential backoff. Set the key and the job will succeed.
 *   - Audio key missing in S3 → `getObjectBuffer` throws, same retry path.
 *   - Event row deleted between enqueue and process → UPDATE affects 0 rows;
 *     we log and let the job complete (nothing useful to retry).
 */
export function startTranscribeWorker(deps: TranscribeWorkerDeps): Worker<queue.TranscribeJobData> {
  const worker = new Worker<queue.TranscribeJobData>(
    queue.QUEUE_NAMES.transcribe,
    async (job: Job<queue.TranscribeJobData>) => processTranscribeJobForTests(deps, job.data),
    {
      connection: queue.getRedisConnection(),
      // Phase 3: one in-flight transcription per worker process. Bump once
      // we have a sense of OpenRouter latency under load.
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
    captureWorkerJobFailure(err, job);
    if (!job) return;
    // BullMQ retries within `attempts`; this handler fires after each
    // attempt. Only mark the row as permanently failed once the attempts
    // budget is exhausted, OR the processor threw an UnrecoverableError
    // (which short-circuits retries — e.g. an oversize audio object will
    // be just as oversize next time). Otherwise transient errors (a brief
    // OpenRouter blip) would surface to the user as a hard failure.
    const maxAttempts = job.opts.attempts ?? 1;
    const unrecoverable = err instanceof UnrecoverableError;
    if (!unrecoverable && job.attemptsMade < maxAttempts) return;
    void markTranscribeFailureForTests(deps, job.data, err).catch((updateErr: unknown) => {
      log.error({ err: updateErr }, 'failed to mark row failure');
      captureWorkerException(updateErr, {
        component: 'worker_failure_marker',
        operation: 'mark_transcription_failure',
      });
    });
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  return worker;
}
