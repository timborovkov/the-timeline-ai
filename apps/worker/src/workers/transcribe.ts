import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
import ffmpegPath from 'ffmpeg-static';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:transcribe');

// Provider requests stay below the OpenAI-compatible transcription upload
// ceiling. Larger source objects are accepted, then transcoded into speech-sized
// chunks before transcription.
const MAX_TRANSCRIPTION_CHUNK_BYTES = 24_000_000;
const MAX_SOURCE_AUDIO_BYTES = 200 * 1024 * 1024;
const LARGE_AUDIO_SEGMENT_SECONDS = 10 * 60;

interface TranscribeWorkerDeps {
  db: Db;
}

export interface TranscribeWorkerIO {
  headObject(input: { audioKey: string }): Promise<{ contentLength?: number | undefined }>;
  getObjectBuffer(input: { audioKey: string; maxBytes: number }): Promise<{ body: Buffer }>;
  transcribeAudio(input: {
    audio: Buffer;
    format?: llm.AudioFormat;
  }): Promise<{ text: string; model: string }>;
  splitAudio(input: { audioKey: string; audio: Buffer }): Promise<Buffer[]>;
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
    async splitAudio(input) {
      return splitAudioForTranscription(input);
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
  if (head.contentLength > MAX_SOURCE_AUDIO_BYTES) {
    throw new UnrecoverableError(
      `Audio object ${audioKey} is ${head.contentLength} bytes; max source size is ${MAX_SOURCE_AUDIO_BYTES}`,
    );
  }
  const { body } = await io.getObjectBuffer({ audioKey, maxBytes: MAX_SOURCE_AUDIO_BYTES });
  const audioChunks =
    body.byteLength > MAX_TRANSCRIPTION_CHUNK_BYTES
      ? await io.splitAudio({ audioKey, audio: body })
      : [body];
  const format =
    body.byteLength > MAX_TRANSCRIPTION_CHUNK_BYTES ? 'mp3' : audioFormatFromAudioKey(audioKey);
  const transcriptions = [];
  for (const audio of audioChunks) {
    transcriptions.push(await io.transcribeAudio({ audio, ...(format ? { format } : {}) }));
  }
  const result = {
    text: transcriptions
      .map((r) => r.text.trim())
      .filter(Boolean)
      .join('\n\n'),
    model: Array.from(new Set(transcriptions.map((r) => r.model))).join('+'),
  };
  const current = await deps.db
    .select({ sourceMetadata: rawEvents.sourceMetadata })
    .from(rawEvents)
    .where(eq(rawEvents.id, rawEventId))
    .limit(1);
  const sourceMetadata =
    typeof current[0]?.sourceMetadata === 'object' &&
    current[0].sourceMetadata !== null &&
    !Array.isArray(current[0].sourceMetadata)
      ? (current[0].sourceMetadata as Record<string, unknown>)
      : {};
  const noteText =
    typeof sourceMetadata.audio_note_text === 'string' ? sourceMetadata.audio_note_text.trim() : '';
  const contentText = [noteText, result.text].filter(Boolean).join('\n\n');

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
      contentText,
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

function audioKeyExtension(audioKey: string): string {
  const ext = path
    .extname(audioKey)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  return ext.length > 1 && ext.length <= 8 ? ext : '.audio';
}

function audioFormatFromAudioKey(audioKey: string): llm.AudioFormat | undefined {
  const ext = path.extname(audioKey).toLowerCase().replace(/^\./u, '');
  if (ext === 'mp3') return 'mp3';
  if (ext === 'wav') return 'wav';
  if (ext === 'flac') return 'flac';
  if (ext === 'm4a' || ext === 'mp4') return 'm4a';
  if (ext === 'ogg' || ext === 'oga') return 'ogg';
  if (ext === 'webm') return 'webm';
  if (ext === 'aac') return 'aac';
  return undefined;
}

async function splitAudioForTranscription(input: {
  audioKey: string;
  audio: Buffer;
}): Promise<Buffer[]> {
  if (!ffmpegPath) throw new Error('ffmpeg binary is not available for large audio transcription');

  const workdir = await mkdtemp(path.join(tmpdir(), `timeline-transcribe-${randomUUID()}-`));
  try {
    const inputPath = path.join(workdir, `source${audioKeyExtension(input.audioKey)}`);
    const outputPattern = path.join(workdir, 'chunk-%03d.mp3');
    await writeFile(inputPath, input.audio);
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      '-f',
      'segment',
      '-segment_time',
      String(LARGE_AUDIO_SEGMENT_SECONDS),
      '-reset_timestamps',
      '1',
      outputPattern,
    ]);

    const files = (await readdir(workdir)).filter((file) => file.endsWith('.mp3')).sort();
    if (files.length === 0) throw new Error('ffmpeg produced no audio chunks');

    const chunks = await Promise.all(files.map((file) => readFile(path.join(workdir, file))));
    const oversize = chunks.find((chunk) => chunk.byteLength > MAX_TRANSCRIPTION_CHUNK_BYTES);
    if (oversize) {
      throw new Error(
        `ffmpeg produced ${oversize.byteLength} byte chunk; max is ${MAX_TRANSCRIPTION_CHUNK_BYTES}`,
      );
    }
    return chunks;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath;
  if (!binary) throw new Error('ffmpeg binary is not available');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = Buffer.concat(stderr).toString('utf8').trim().slice(0, 1200);
      reject(new Error(`ffmpeg exited with code ${code}${details ? `: ${details}` : ''}`));
    });
  });
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
