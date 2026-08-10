import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import { getAudioBucket, getDocumentsBucket, getS3Client, putObject } from '@timeline/shared/s3';
import * as telegram from '@timeline/shared/telegram';

import { trackProductEventBestEffort } from '@/lib/analytics';
import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { reportCaughtError, reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:telegram');

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    // Feature gated off in this environment.
    reportHandledEvent({
      message: 'telegram_webhook_disabled',
      surface: 'api',
      operation: 'telegram_webhook_config',
      level: 'warning',
      tags: { reason: 'webhook_disabled' },
    });
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  const header = req.headers.get('x-telegram-bot-api-secret-token');
  if (!telegram.verifyWebhookSecret(header, expected)) {
    reportHandledEvent({
      message: 'telegram_webhook_forbidden',
      surface: 'api',
      operation: 'telegram_webhook_auth',
      level: 'warning',
      tags: { reason: 'forbidden', has_secret_header: Boolean(header) },
    });
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    reportHandledEvent({
      message: 'telegram_webhook_invalid_json',
      surface: 'api',
      operation: 'telegram_webhook_parse',
      level: 'warning',
      tags: { reason: 'invalid_json' },
    });
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  // Rate-limit per Telegram user id. The webhook secret authenticates the
  // *Telegram server*, not the sender, so an abusive user spamming a bot
  // would otherwise pass. Return 200 either way so Telegram doesn't retry-
  // storm; the dispatch is just skipped.
  const tgUserId = extractTelegramUserId(payload);
  if (tgUserId !== undefined) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('tg', 'user', tgUserId),
      ...rateLimit.RATE_LIMITS.telegramWebhook,
    });
    if (!rl.ok) {
      log.warn({ tgUserId, retryAfterMs: rl.retryAfterMs }, 'telegram_rate_limited');
      return Response.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
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
          const queue = await requireRedisQueue();
          await queue.enqueueTranscribeJob(input);
        },
        buildAudioKey({ teamId, chatId, messageId, fileId, extension }) {
          return `teams/${teamId}/telegram/${chatId}/${messageId}-${fileId}.${extension}`;
        },
      }
    : undefined;

  const documentsReady = Boolean(
    env.S3_ENDPOINT &&
    env.S3_REGION &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY &&
    env.S3_BUCKET_DOCUMENTS &&
    env.REDIS_URL,
  );
  const documentDeps: telegram.DocumentAttachmentDeps | undefined = documentsReady
    ? {
        async upload(input) {
          await putObject(getS3Client(), {
            bucket: getDocumentsBucket(),
            key: input.key,
            body: input.body,
            contentType: input.contentType,
          });
        },
        async enqueueExtract(input) {
          const queue = await requireRedisQueue();
          await queue.enqueueDocumentExtractJob(input);
        },
      }
    : undefined;

  // Extract enqueue is gated on REDIS_URL only — no S3 needed for the text
  // path. When Redis is unreachable, text events still land; facts are
  // missing until reextract.
  const extractDeps: telegram.ExtractEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueExtract(input) {
          const queue = await requireRedisQueue();
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
          const queue = await requireRedisQueue();
          await queue.enqueueEmbedJob(input);
        },
      }
    : undefined;

  const suggestionDeps: telegram.SuggestionEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueSuggestion(input) {
          const queue = await requireRedisQueue();
          await queue.enqueueSuggestionJob(input);
        },
      }
    : undefined;

  try {
    const deps: Parameters<typeof telegram.handleUpdate>[0] = {
      db,
      tg: api,
      agentDeps: {
        onApprovalDecision: ({ teamId, userId, decision, itemCount, isBulk }) => {
          trackProductEventBestEffort(userId, 'approval_decision_submitted', {
            teamId,
            userId,
            decision,
            itemCount,
            isBulk,
          });
        },
      },
      onAgentToolError(err, context) {
        reportCaughtError(err, {
          surface: 'background',
          operation: 'telegram_agent_tool_call',
          tags: { tool: context.tool },
        });
      },
      onAgentError(err) {
        reportCaughtError(err, { surface: 'background', operation: 'telegram_agent_run' });
      },
    };
    if (audioDeps) deps.audio = audioDeps;
    if (documentDeps) deps.documents = documentDeps;
    if (extractDeps) deps.extract = extractDeps;
    if (embedDeps) deps.embed = embedDeps;
    if (suggestionDeps) deps.suggestions = suggestionDeps;
    await telegram.handleUpdate(deps, payload);
  } catch (err) {
    // Swallow — Telegram retries non-2xx, and we never want infinite retries.
    log.error({ err }, 'handler error');
    reportCaughtError(err, { surface: 'background', operation: 'telegram_webhook_handler' });
  }
  return Response.json({ ok: true }, { status: 200 });
}

function extractTelegramUserId(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const candidates = ['message', 'edited_message', 'channel_post', 'edited_channel_post'];
  for (const k of candidates) {
    const msg = p[k];
    if (msg && typeof msg === 'object') {
      const from = (msg as Record<string, unknown>).from;
      if (from && typeof from === 'object') {
        const id = (from as Record<string, unknown>).id;
        if (typeof id === 'number') return id;
      }
    }
  }
  return undefined;
}
