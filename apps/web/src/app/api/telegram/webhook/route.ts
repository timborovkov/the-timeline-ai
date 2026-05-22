import { childLogger, getAudioBucket, getEnv, getS3Client, putObject, queue, telegram } from '@timeline/shared';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:telegram');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // Feature gated off in this environment.
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  const header = req.headers.get('x-telegram-bot-api-secret-token');
  if (!telegram.verifyWebhookSecret(header, expected)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  const api = env.TELEGRAM_BOT_TOKEN
    ? new telegram.HttpTelegramApi(env.TELEGRAM_BOT_TOKEN)
    : new telegram.NoopTelegramApi();

  // Audio ingest is only wired when ALL required S3 credentials are present
  // and Redis is reachable. A partial S3 config (e.g. endpoint set but no
  // access key) used to silently fail downstream in getS3Client(); now the
  // dispatcher just doesn't get audio deps and voice memos are dropped with
  // a log line — the same shape as the Phase 2 behavior for unsupported
  // media types.
  const audioReady = Boolean(
    env.S3_ENDPOINT &&
    env.S3_REGION &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY &&
    env.S3_BUCKET_AUDIO &&
    env.REDIS_URL,
  );
  const audioDeps: telegram.AudioIngestDeps | undefined = audioReady
    ? {
        async upload(input) {
          await putObject(getS3Client(), {
            bucket: getAudioBucket(),
            key: input.key,
            body: input.body,
            contentType: input.contentType,
          });
        },
        async enqueueTranscribe(input) {
          await queue.enqueueTranscribeJob(input);
        },
        buildAudioKey({ teamId, chatId, messageId, fileId, extension }) {
          return `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`;
        },
      }
    : undefined;

  // Extract enqueue is gated on REDIS_URL only — no S3 needed for the text
  // path. When Redis is unreachable, text events still land; facts are
  // missing until reextract.
  const extractDeps: telegram.ExtractEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueExtract(input) {
          await queue.enqueueExtractJob(input);
        },
      }
    : undefined;

  // Phase 5: embed enqueue is gated on REDIS_URL only (same as extract).
  // Qdrant availability is checked at the worker, not here — text events
  // still land if Qdrant is down; they get a deferred embedding via reembed.
  const embedDeps: telegram.EmbedEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueEmbed(input) {
          await queue.enqueueEmbedJob(input);
        },
      }
    : undefined;

  try {
    const deps: Parameters<typeof telegram.handleUpdate>[0] = { db, tg: api };
    if (audioDeps) deps.audio = audioDeps;
    if (extractDeps) deps.extract = extractDeps;
    if (embedDeps) deps.embed = embedDeps;
    await telegram.handleUpdate(deps, payload);
  } catch (err) {
    // Swallow — Telegram retries non-2xx, and we never want infinite retries.
    log.error({ err }, 'handler error');
  }
  return Response.json({ ok: true }, { status: 200 });
}
