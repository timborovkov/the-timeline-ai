import * as email from '@timeline/shared/email';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as meetingsScope from '@timeline/shared/meetings';
import * as rateLimit from '@timeline/shared/rate-limit';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireRedisQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:recall:transcript');

// Unsigned realtime transcript webhook from Recall.ai. Security relies on:
//   * botId lookup — bots are issued by Recall after our authenticated
//     joinMeeting() call, so a forged botId cannot match any meeting.
//   * Zod validation — malformed payloads are rejected without DB writes.
//   * Per-bot rate limit — caps a runaway / spoofed sender.
//
// We deliberately do NOT sign this endpoint. Recall does not Svix-sign
// realtime transcript events; the proof-of-association IS the botId.
//
// Status-code contract:
//   - 503 when not configured.
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
            transcript: z
              .object({
                id: z.string().nullable().optional(),
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
  providerChunkId: string | null;
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
    providerChunkId: d.transcript?.id ?? null,
  };
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.RECALL_API_KEY) {
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }

  // Per-IP gate. Sits in front of the meeting lookup so an attacker
  // rotating random botIds can't burn Postgres capacity hammering the
  // `provider_bot_id` index. Recall's transcript webhook is unsigned by
  // design; the per-bot bucket below handles per-meeting burst, but only
  // for known bot ids. Always return 200 so the sender doesn't retry-storm.
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
    raw = await req.json();
  } catch {
    return Response.json({ ok: true, reason: 'invalid_json' }, { status: 200 });
  }
  let parsed: z.infer<typeof transcriptSchema>;
  try {
    parsed = transcriptSchema.parse(raw);
  } catch (err) {
    log.warn({ err }, 'invalid_transcript_payload');
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

  // Look up meeting by botId. No team scope on the lookup itself — bot
  // ids are globally unique (Recall UUIDs).
  const meeting = await meetingsScope.lookupMeetingByBotId(db, chunk.botId);
  if (!meeting) {
    log.info({ botId: chunk.botId }, 'no_meeting_for_bot');
    return Response.json({ ok: true, reason: 'no_meeting' }, { status: 200 });
  }

  try {
    const scope = withTeam(db, meeting.teamId, meeting.createdByUserId ?? meeting.teamId);
    const result = await scope.meetings.appendMeetingChunk({
      meetingId: meeting.id,
      speaker: chunk.speaker,
      text: chunk.text,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      providerChunkId: chunk.providerChunkId,
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
    }
    return Response.json({ ok: true, chunkId: result.chunkId }, { status: 200 });
  } catch (err) {
    log.error({ err, botId: chunk.botId }, 'transcript_handler_error');
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }
}
