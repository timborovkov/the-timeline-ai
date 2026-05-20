import { type Db, rawEvents } from '@timeline/db';
import { getAudioBucket, getObjectBuffer, getS3Client, llm, queue } from '@timeline/shared';
import { type Job, Worker } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

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
      const { body, contentType } = await getObjectBuffer(s3, bucket, audioKey);
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
  });
  worker.on('completed', (job) => {
    console.log(`[worker:transcribe] job ${job.id} completed`);
  });

  return worker;
}
