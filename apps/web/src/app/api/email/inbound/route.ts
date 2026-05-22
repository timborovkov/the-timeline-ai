import {
  childLogger,
  email,
  getAttachmentsBucket,
  getAudioBucket,
  getEnv,
  getS3Client,
  putObject,
  queue,
} from '@timeline/shared';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:email');

/**
 * Postmark inbound webhook. Status-code contract:
 *   - 503 when the feature is not configured for this environment.
 *   - 401 on signature failure (constant-time compare).
 *   - 503 when EVERY matched team's ingest threw (transient DB / S3 / queue
 *     failure) or when the top-level handler itself crashed. Postmark
 *     retries 5xx with exponential backoff; the partial unique index on
 *     `(team_id, message_id)` makes those retries idempotent at the DB.
 *   - 200 on every other outcome: successful ingest, schema-invalid
 *     payload, no recipients, no matching team, dedup hit. These are all
 *     terminal — retry doesn't help and would just spam Postmark queues.
 *
 * Heavy work (S3 uploads, queue enqueues) runs inside the dispatcher
 * before we return; the unit of work for one inbound email is small enough
 * that doing it inline beats the operational cost of a second queue. If
 * Postmark begins to time out on us we'll move the dispatcher to a queue
 * — but only then.
 */
export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  // Webhook is enabled when EITHER routing path is configured: a real
  // inbound MX domain OR the Postmark default address (dev mode). At least
  // one must be present, plus the basic-auth secret.
  if (
    !env.POSTMARK_WEBHOOK_SECRET ||
    (!env.INBOUND_EMAIL_DOMAIN && !env.POSTMARK_INBOUND_ADDRESS)
  ) {
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (!email.verifyPostmarkBasicAuth(auth, env.POSTMARK_WEBHOOK_SECRET)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  // Attachment uploads need S3. Audio attachments additionally need Redis
  // to enqueue the transcribe job, but a missing Redis MUST NOT silently
  // drop non-audio attachments — PDFs / images only touch S3. The
  // dispatcher's per-call try/catch handles the audio path: when
  // `enqueueTranscribe` throws (no Redis), the child raw_event gets a
  // `transcription_failed_at` marker so the audio still lands and a future
  // reconciler can replay the enqueue. Gate only on S3 readiness here.
  const attachmentsReady = Boolean(
    env.S3_ENDPOINT &&
    env.S3_REGION &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY &&
    env.S3_BUCKET_ATTACHMENTS &&
    env.S3_BUCKET_AUDIO,
  );
  const attachmentsDeps: email.EmailAttachmentDeps | undefined = attachmentsReady
    ? {
        async uploadAttachment(input) {
          await putObject(getS3Client(), {
            bucket: getAttachmentsBucket(),
            key: input.key,
            body: input.body,
            contentType: input.contentType,
          });
        },
        async uploadAudio(input) {
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
        buildAttachmentKey({ teamId, messageId, filename }) {
          return `teams/${teamId}/email/${safeForKey(messageId)}/${safeForKey(filename)}`;
        },
        buildAudioKey({ teamId, messageId, filename }) {
          return `teams/${teamId}/email-audio/${safeForKey(messageId)}/${safeForKey(filename)}`;
        },
      }
    : undefined;

  const extractDeps: email.ExtractEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueExtract(input) {
          await queue.enqueueExtractJob(input);
        },
      }
    : undefined;

  const embedDeps: email.EmbedEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueEmbed(input) {
          await queue.enqueueEmbedJob(input);
        },
      }
    : undefined;

  try {
    const deps: email.DispatcherDeps = { db };
    if (env.INBOUND_EMAIL_DOMAIN) deps.inboundDomain = env.INBOUND_EMAIL_DOMAIN;
    if (env.POSTMARK_INBOUND_ADDRESS) deps.postmarkInboundAddress = env.POSTMARK_INBOUND_ADDRESS;
    if (env.POSTMARK_AUTHSERV_IDS) {
      deps.trustedAuthservIds = env.POSTMARK_AUTHSERV_IDS.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (attachmentsDeps) deps.attachments = attachmentsDeps;
    if (extractDeps) deps.extract = extractDeps;
    if (embedDeps) deps.embed = embedDeps;
    const result = await email.handleInbound(deps, payload);
    // 503 when EVERY matched team's ingest threw — likely a DB / S3 / queue
    // outage that the original delivery never durably persisted. Returning
    // 200 here would let Postmark forget the message and silently drop it.
    // Postmark retries on 5xx with exponential backoff, which is exactly
    // what we want for transient infra. Soft logic failures (no recipients,
    // no matching team, schema mismatch) stay 200 — retry won't help.
    if (result.reason === 'all_teams_failed') {
      return Response.json({ ok: false, reason: result.reason, inserted: 0 }, { status: 503 });
    }
    return Response.json({ ok: result.ok, inserted: result.inserted }, { status: 200 });
  } catch (err) {
    // handleInbound is designed not to throw, but if its top-level wrapper
    // ever fails (e.g. a Zod-pre-validation crash), surface 5xx so Postmark
    // retries. The route had previously swallowed this to 200 on the
    // theory that retries are our problem — but without a reconciler we'd
    // silently lose the message.
    log.error({ err }, 'handler crash');
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }
}

function safeForKey(input: string): string {
  // Object keys mustn't contain `..` segments, raw spaces, or other URL-unsafe
  // characters. Postmark Message-IDs can contain `@`, `<>`, and arbitrary
  // characters from the sending MTA.
  return input.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
}
