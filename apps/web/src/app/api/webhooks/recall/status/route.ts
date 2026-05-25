import { meetings as meetingsTable } from '@timeline/db';
import { childLogger, getEnv, meetingBots, queue, withTeam } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = childLogger('web:api:recall:status');

// Svix-signed bot lifecycle webhook from Recall.ai. We flip the
// meeting's status on each transition; on `bot.call_ended` /
// `transcript.done` we enqueue the meeting-finalize job which generates
// the summary, extracts action items, and records minutes.
//
// Status-code contract:
//   - 503 when not configured (no secret).
//   - 401 on bad signature.
//   - 200 on every other outcome (recognised event applied, unknown event
//     ignored). Recall retries 5xx with exponential backoff — we only
//     emit 5xx when WE crash.
//
// We deliberately do NOT trust the payload's team_id / meeting_id for
// authorisation — the meeting row is looked up by `provider_bot_id`,
// which is set by us at join time.

const statusEventSchema = z.object({
  event: z.string(),
  data: z
    .object({
      bot: z
        .object({
          id: z.string(),
          metadata: z.record(z.unknown()).optional(),
          status: z
            .object({
              code: z.string().optional(),
              created_at: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
      status: z
        .object({
          code: z.string().optional(),
          created_at: z.string().optional(),
        })
        .optional(),
    })
    .passthrough(),
});

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.RECALL_STATUS_WEBHOOK_SECRET) {
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }

  const body = await req.text();
  const verify = meetingBots.verifySvixSignature({
    body,
    headers: req.headers,
    secret: env.RECALL_STATUS_WEBHOOK_SECRET,
  });
  if (!verify.ok) {
    log.warn({ reason: verify.reason }, 'svix_verification_failed');
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let parsed: z.infer<typeof statusEventSchema>;
  try {
    parsed = statusEventSchema.parse(JSON.parse(body));
  } catch (err) {
    log.warn({ err }, 'invalid_payload');
    return Response.json({ ok: true, reason: 'invalid_payload' }, { status: 200 });
  }

  const botId = parsed.data.bot?.id;
  if (!botId) {
    return Response.json({ ok: true, reason: 'no_bot_id' }, { status: 200 });
  }

  // Resolve the meeting by bot id only — no team scope, this is the
  // webhook's authoritative lookup.
  const meetingRows = await db
    .select({
      id: meetingsTable.id,
      teamId: meetingsTable.teamId,
      createdByUserId: meetingsTable.createdByUserId,
      status: meetingsTable.status,
    })
    .from(meetingsTable)
    .where(eq(meetingsTable.providerBotId, botId))
    .limit(1);
  const meeting = meetingRows[0];
  if (!meeting) {
    log.warn({ botId, event: parsed.event }, 'meeting_not_found_for_bot');
    return Response.json({ ok: true, reason: 'meeting_not_found' }, { status: 200 });
  }

  // System scope: use createdByUserId so visibility-aware reads work.
  // updateMeetingStatus itself doesn't go through ensureMember.
  const scope = withTeam(db, meeting.teamId, meeting.createdByUserId ?? meeting.teamId);

  const code = parsed.data.bot?.status?.code ?? parsed.data.status?.code;
  const createdAt = parsed.data.bot?.status?.created_at ?? parsed.data.status?.created_at;
  const mappedStatus = code ? meetingBots.recallMapStatus(code) : null;

  try {
    if (parsed.event === 'bot.status_change' && mappedStatus) {
      const patch: Parameters<typeof scope.updateMeetingStatus>[2] = {
        metadata: { last_status: code, last_status_at: createdAt ?? new Date().toISOString() },
      };
      if (mappedStatus === 'active') patch.startedAt = createdAt ? new Date(createdAt) : new Date();
      if (mappedStatus === 'processing')
        patch.endedAt = createdAt ? new Date(createdAt) : new Date();
      await scope.updateMeetingStatus(meeting.id, mappedStatus, patch);
    } else if (parsed.event === 'bot.call_ended') {
      await scope.updateMeetingStatus(meeting.id, 'processing', {
        endedAt: createdAt ? new Date(createdAt) : new Date(),
        metadata: { call_ended_at: createdAt ?? new Date().toISOString() },
      });
      if (env.REDIS_URL) {
        await queue.enqueueMeetingFinalizeJob({
          meetingId: meeting.id,
          teamId: meeting.teamId,
        });
      } else {
        log.warn({ meetingId: meeting.id }, 'redis_unavailable_skipping_finalize_enqueue');
      }
    } else if (parsed.event === 'bot.fatal' || parsed.event === 'bot.failed') {
      await scope.updateMeetingStatus(meeting.id, 'failed', {
        metadata: { failure_at: new Date().toISOString(), failure_code: code ?? 'unknown' },
      });
    }
    // Unknown events are intentionally ignored — Recall ships new event
    // types regularly and we don't want 5xx to trigger retry storms.
  } catch (err) {
    log.error({ err, botId, event: parsed.event }, 'status_handler_error');
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
