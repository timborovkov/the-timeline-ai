import { type Db, rawEvents } from '@timeline/db';
import {
  getAudioBucket,
  getObjectBuffer,
  getS3Client,
  headObject,
  llm,
  queue,
} from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

// Phase 3 cap: 25 MB. Telegram voice memos are well under this; the web
// recorder doesn't enforce a duration cap (acceptable Phase 3 trade-off),
// but we refuse to read a runaway upload into memory on the worker side.
// When long-form audio lands (Phase 4+), this should be replaced with
// streaming straight from S3 to the transcription provider.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

interface TranscribeWorkerDeps {
  db: Db;
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
    async (job: Job<queue.TranscribeJobData>) => {
      const { rawEventId, audioKey } = job.data;
      const s3 = getS3Client();
      const bucket = getAudioBucket();
      // Bounds-check before reading the body into memory. UnrecoverableError
      // tells BullMQ to skip retries — an oversize object will be just as
      // oversize on the next attempt, and we don't want to repeatedly OOM
      // the worker. A missing Content-Length is also unrecoverable: we
      // cannot trust an unbounded body to fit. The mid-stream cap in
      // getObjectBuffer is defense in depth against a server that hides
      // the header or a body that exceeds its advertised length.
      const head = await headObject(s3, bucket, audioKey);
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
      const { body, contentType } = await getObjectBuffer(s3, bucket, audioKey, MAX_AUDIO_BYTES);
      const filename = audioKey.split('/').pop() ?? 'audio';
      const result = await llm.transcribeAudio({
        audio: body,
        filename,
        mimeType: contentType ?? 'application/octet-stream',
      });

      const patch = JSON.stringify({
        transcription_model: result.model,
        transcribed_at: new Date().toISOString(),
      });
      const update = await deps.db
        .update(rawEvents)
        .set({
          contentText: result.text,
          sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
        })
        .where(eq(rawEvents.id, rawEventId))
        .returning({ id: rawEvents.id });
      if (update.length === 0) {
        console.warn(`[worker:transcribe] raw event ${rawEventId} not found at update`);
      }
      return { rawEventId, model: result.model };
    },
    {
      connection: queue.getRedisConnection(),
      // Phase 3: one in-flight transcription per worker process. Bump once
      // we have a sense of OpenRouter latency under load.
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[worker:transcribe] job ${job?.id} failed:`, err.message);
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
    const patch = JSON.stringify({
      transcription_failed_at: new Date().toISOString(),
      transcription_error: err.message.slice(0, 500),
    });
    void deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, job.data.rawEventId))
      .catch((updateErr: unknown) => {
        console.error('[worker:transcribe] failed to mark row failure', updateErr);
      });
  });
  worker.on('completed', (job) => {
    console.log(`[worker:transcribe] job ${job.id} completed`);
  });

  return worker;
}
