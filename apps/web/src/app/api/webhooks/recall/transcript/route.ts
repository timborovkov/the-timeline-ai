import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as meetingBots from '@timeline/shared/meeting-bots';
import * as meetingsScope from '@timeline/shared/meetings';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';
import {
  payloadTooLargeResponse,
  readCappedTextBody,
  REQUEST_BODY_LIMITS,
} from '@/lib/request-body';
import { reportCaughtError, reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:recall:transcript');
const TERMINAL_MEETING_STATUSES = new Set([
  'completed',
  'completed_partial',
  'failed',
  'skipped',
  'no_show',
  'cancelled',
]);

// Workspace-signed realtime transcript webhook from Recall.ai. Authentication
// covers the exact raw body and runs before parsing, rate limiting, bot lookup,
// or team-scoped persistence. Bot-id correlation and rate limits remain
// defense in depth after the provider signature is accepted.
//
// Status-code contract:
//   - 503 when the API key or workspace verification secret is not configured.
//   - 401 on a missing, stale, malformed, or invalid signature.
//   - 200 on bad payload, unknown bot, dedup — Recall must not retry.
//   - 200 on successful chunk insert.
//   - 503 only on top-level handler crash.

const transcriptSchema = z
  .object({
    event: z.string().optional(),
    data: z
      .object({
        bot: z.object({ id: z.string() }).optional(),
        bot_id: z.string().optional(),
        transcript: z
          .object({
            id: z.string().nullable().optional(),
          })
          .loose()
          .optional(),
        data: z
          .object({
            words: z
              .array(
                z.object({
                  text: z.string(),
                  start_timestamp: z
                    .object({ relative: z.number().optional() })
                    .optional()
                    .nullable(),
                  end_timestamp: z
                    .object({ relative: z.number().optional() })
                    .optional()
                    .nullable(),
                }),
              )
              .optional(),
            participant: z
              .object({
                name: z.string().nullable().optional(),
                id: z.number().or(z.string()).nullable().optional(),
              })
              .optional(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();

/**
 * Coerce Recall's "transcript.data" event into our flat chunk shape.
 * Returns null when the payload is partial / unfinalised.
 */
function buildChunkFromPayload(payload: z.infer<typeof transcriptSchema>): {
  botId: string;
  speaker: string | null;
  text: string;
  startMs: number;
  endMs: number;
} | null {
  const botId = payload.data.bot?.id ?? payload.data.bot_id;
  if (!botId) return null;
  const d = payload.data.data;
  if (!d) return null;
  const words = d.words ?? [];
  if (words.length === 0) return null;
  const text = words
    .map((w) => w.text)
    .join(' ')
    .trim();
  if (!text) return null;
  const startRel = words[0]?.start_timestamp?.relative;
  const endRel = words[words.length - 1]?.end_timestamp?.relative;
  const startMs = typeof startRel === 'number' ? Math.round(startRel * 1000) : 0;
  const endMs = typeof endRel === 'number' ? Math.round(endRel * 1000) : startMs;
  return {
    botId,
    speaker: d.participant?.name ?? null,
    text,
    startMs,
    endMs,
  };
}

function signedDeliveryId(headers: Headers): string {
  // A successful signature verification guarantees one of these aliases is a
  // non-empty part of the signed payload. This delivery id, unlike Recall's
  // transcript resource id, is stable across retries of one webhook message.
  return headers.get('svix-id') ?? headers.get('webhook-id') ?? '';
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.RECALL_API_KEY || !env.RECALL_WORKSPACE_VERIFICATION_SECRET) {
    reportHandledEvent({
      message: 'recall_transcript_webhook_disabled',
      surface: 'api',
      operation: 'recall_transcript_config',
      level: 'warning',
      tags: { reason: 'webhook_disabled' },
    });
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.recallTranscript);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const verify = meetingBots.verifySvixSignature({
    body,
    headers: req.headers,
    secret: env.RECALL_WORKSPACE_VERIFICATION_SECRET,
  });
  if (!verify.ok) {
    log.warn({ reason: verify.reason }, 'webhook_verification_failed');
    reportHandledEvent({
      message: 'recall_transcript_webhook_verification_failed',
      surface: 'api',
      operation: 'recall_transcript_webhook_verification',
      level: 'warning',
      tags: {
        reason: verify.reason,
        has_webhook_id: req.headers.has('webhook-id') || req.headers.has('svix-id'),
        has_webhook_timestamp:
          req.headers.has('webhook-timestamp') || req.headers.has('svix-timestamp'),
        has_webhook_signature:
          req.headers.has('webhook-signature') || req.headers.has('svix-signature'),
      },
    });
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }
  const providerChunkId = signedDeliveryId(req.headers);

  // Per-IP gate. Sits in front of the meeting lookup so an attacker
  // rotating random botIds can't burn Postgres capacity hammering the
  // `provider_bot_id` index. The per-bot bucket below handles per-meeting
  // bursts. Always return 200 so the sender doesn't retry-storm.
  const clientIp = email.clientIpFromHeaders(req.headers);
  if (clientIp) {
    const ipRl = await rateLimit.checkRateLimit({
      key: rateLimit.rateLimitKey('recall', 'transcript_ip', clientIp),
      ...rateLimit.RATE_LIMITS.recallTranscriptIp,
    });
    if (!ipRl.ok) {
      log.warn({ clientIp, retryAfterMs: ipRl.retryAfterMs }, 'transcript_ip_rate_limited');
      return Response.json({ ok: true, reason: 'ip_rate_limited' }, { status: 200 });
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    reportHandledEvent({
      message: 'recall_transcript_invalid_json',
      surface: 'api',
      operation: 'recall_transcript_parse',
      level: 'warning',
      tags: { reason: 'invalid_json' },
    });
    return Response.json({ ok: true, reason: 'invalid_json' }, { status: 200 });
  }
  let parsed: z.infer<typeof transcriptSchema>;
  try {
    parsed = transcriptSchema.parse(raw);
  } catch (err) {
    log.warn({ err }, 'invalid_transcript_payload');
    reportHandledEvent({
      message: 'recall_transcript_invalid_payload',
      surface: 'api',
      operation: 'recall_transcript_parse',
      level: 'warning',
      tags: { reason: 'invalid_payload' },
    });
    return Response.json({ ok: true, reason: 'invalid_payload' }, { status: 200 });
  }

  // Drop partial / interim transcripts — only finalised utterances flow
  // into the timeline. Partials are useful for live UI but would bloat
  // raw_events with churn.
  const eventName = parsed.event ?? '';
  if (eventName === 'transcript.partial_data') {
    return Response.json({ ok: true, reason: 'partial' }, { status: 200 });
  }

  const chunk = buildChunkFromPayload(parsed);
  if (!chunk) {
    return Response.json({ ok: true, reason: 'no_chunk' }, { status: 200 });
  }

  // Per-bot rate limit. A runaway provider or replay should not flood
  // the pipeline. Always 200 so the sender doesn't retry-storm.
  const rl = await rateLimit.checkRateLimit({
    key: rateLimit.rateLimitKey('recall', 'transcript', chunk.botId),
    ...rateLimit.RATE_LIMITS.recallTranscript,
  });
  if (!rl.ok) {
    log.warn({ botId: chunk.botId, retryAfterMs: rl.retryAfterMs }, 'transcript_rate_limited');
    return Response.json({ ok: true, reason: 'rate_limited' }, { status: 200 });
  }

  // Look up the meeting by Recall bot id before constructing a team scope.
  // The lookup fails closed if an unexpected cross-team duplicate exists.
  const meeting = await meetingsScope.lookupMeetingByBotId(db, chunk.botId);
  if (!meeting) {
    log.info({ botId: chunk.botId }, 'no_meeting_for_bot');
    return Response.json({ ok: true, reason: 'no_meeting' }, { status: 200 });
  }

  if (TERMINAL_MEETING_STATUSES.has(meeting.status)) {
    log.info(
      { botId: chunk.botId, meetingId: meeting.id, currentStatus: meeting.status },
      'ignoring_transcript_terminal_status',
    );
    return Response.json(
      { ok: true, reason: 'terminal_status', status: meeting.status },
      { status: 200 },
    );
  }

  try {
    const scope = withTeam(db, meeting.teamId, meeting.createdByUserId ?? meeting.teamId);
    const result = await scope.meetings.appendMeetingChunk({
      meetingId: meeting.id,
      speaker: chunk.speaker,
      text: chunk.text,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      providerChunkId,
    });
    if (!result) {
      return Response.json({ ok: true, reason: 'insert_failed' }, { status: 200 });
    }
    if (result.deduplicated) {
      return Response.json({ ok: true, reason: 'duplicate' }, { status: 200 });
    }
    // Embed the chunk for utterance-granular search. No per-chunk
    // raw_event — a single consolidated event is created by the
    // meeting-finalize worker when the call ends.
    if (env.REDIS_URL) {
      const queue = await requireRedisQueue();
      await queue.enqueueMeetingChunkEmbedJob(meeting.teamId, result.chunkId);
      if (meeting.defaultVisibility === 'team' && result.refreshedCalendarEventId) {
        await queue.enqueueCalendarEventEmbedJob(meeting.teamId, result.refreshedCalendarEventId);
      }
    }
    return Response.json({ ok: true, chunkId: result.chunkId }, { status: 200 });
  } catch (err) {
    log.error({ err, botId: chunk.botId }, 'transcript_handler_error');
    reportCaughtError(err, { surface: 'api', operation: 'recall_transcript_handler' });
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }
}
