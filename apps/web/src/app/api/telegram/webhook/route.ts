import { getAudioBucket, getEnv, getS3Client, putObject, queue, telegram } from '@timeline/shared';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  // Audio ingest is only wired when both S3 and Redis are configured. With
  // either missing, voice messages are dropped (logged) — same shape as the
  // Phase 2 behavior for unsupported media types.
  const audioReady = Boolean(env.S3_ENDPOINT && env.S3_BUCKET_AUDIO && env.REDIS_URL);
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

  try {
    const deps = audioDeps ? { db, tg: api, audio: audioDeps } : { db, tg: api };
    await telegram.handleUpdate(deps, payload);
  } catch (err) {
    // Swallow — Telegram retries non-2xx, and we never want infinite retries.
    console.error('[telegram] handler error', err);
  }
  return Response.json({ ok: true }, { status: 200 });
}
