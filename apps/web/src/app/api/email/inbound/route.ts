import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as rateLimit from '@timeline/shared/rate-limit';
import { getAttachmentsBucket, getAudioBucket, getS3Client, putObject } from '@timeline/shared/s3';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import { reportCaughtError } from '@/lib/sentry-report';

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

  const clientIp = email.clientIpFromHeaders(req.headers);

  // Pre-auth IP filter: reject with 403 (not 401) so attackers can't probe
  // whether they had the right Basic-Auth secret. Optional — when
  // POSTMARK_INBOUND_IPS is unset, skip (matches the opt-in pattern used
  // by POSTMARK_AUTHSERV_IDS).
  if (env.POSTMARK_INBOUND_IPS) {
    const cidrs = email.parseCidrList(env.POSTMARK_INBOUND_IPS);
    if (!email.isIpAllowed(clientIp, cidrs)) {
      log.warn({ clientIp }, 'inbound_ip_rejected');
      return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }
  }

  const auth = req.headers.get('authorization');
  if (!email.verifyPostmarkBasicAuth(auth, env.POSTMARK_WEBHOOK_SECRET)) {
    // Hard-rate-limit 401s per source IP so a credential-spray attack
    // gets locked out fast. Key on IP because the Basic-Auth header is
    // exactly what the attacker is guessing.
    if (clientIp) {
      const authRl = await rateLimit.checkRateLimit({
        key: rateLimit.rateLimitKey('email', 'auth', clientIp),
        ...rateLimit.RATE_LIMITS.emailInboundAuth,
      });
      if (!authRl.ok) {
        log.warn({ clientIp, retryAfterMs: authRl.retryAfterMs }, 'webhook_auth_lockout');
        return Response.json(
          { ok: false, reason: 'rate_limited' },
          {
            status: 429,
            headers: { 'Retry-After': String(Math.ceil(authRl.retryAfterMs / 1000)) },
          },
        );
      }
    }
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, reason: 'invalid_json' }, { status: 200 });
  }

  // Per-From rate limit. A compromised account or a runaway forwarder
  // shouldn't be able to flood the ingest pipeline. Return 200 so Postmark
  // doesn't retry; the message is intentionally dropped.
  const fromEmail = extractFromAddress(payload);
  if (fromEmail) {
    const rl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('email', 'from', fromEmail.toLowerCase()),
      ...rateLimit.RATE_LIMITS.emailInbound,
    });
    if (!rl.ok) {
      log.warn({ fromEmail, retryAfterMs: rl.retryAfterMs }, 'email_rate_limited');
      return Response.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
    }
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
          const queue = await requireRedisQueue();
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
          const queue = await requireRedisQueue();
          await queue.enqueueExtractJob(input);
        },
      }
    : undefined;

  const embedDeps: email.EmbedEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueEmbed(input) {
          const queue = await requireRedisQueue();
          await queue.enqueueEmbedJob(input);
        },
      }
    : undefined;

  const suggestionDeps: email.SuggestionEnqueueDeps | undefined = env.REDIS_URL
    ? {
        async enqueueSuggestion(input) {
          const queue = await requireRedisQueue();
          await queue.enqueueSuggestionJob(input);
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
    if (suggestionDeps) deps.suggestions = suggestionDeps;
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
    reportCaughtError(err, { surface: 'api', operation: 'email_inbound_handler' });
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }
}

function extractFromAddress(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  // Prefer Postmark's pre-parsed FromFull.Email; fall back to the raw From
  // header. Without the fallback, rate limiting silently misses payloads
  // shaped slightly differently from the docs.
  const fromFull = p.FromFull;
  if (fromFull && typeof fromFull === 'object') {
    const email = (fromFull as Record<string, unknown>).Email;
    if (typeof email === 'string' && email.trim()) return email.trim().toLowerCase();
  }
  const from = p.From ?? p.from;
  if (typeof from !== 'string') return undefined;
  const m = /<([^>]+)>/.exec(from);
  const addr = m?.[1] ?? from;
  return addr.trim().toLowerCase() || undefined;
}

function safeForKey(input: string): string {
  // Object keys mustn't contain `..` segments, raw spaces, or other URL-unsafe
  // characters. Postmark Message-IDs can contain `@`, `<>`, and arbitrary
  // characters from the sending MTA.
  return input.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
}
