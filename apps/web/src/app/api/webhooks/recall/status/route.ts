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

  // Terminal-state guard. `completed` (finalize ran) and `failed` (user
  // cancelled or bot crashed) are absorbing states — Recall can replay
  // status events well after the meeting reached terminal, and we must
  // not let a late `bot.status_change` regress them to `processing` or
  // re-enqueue finalize over a cancelled meeting. Return 200 so Recall
  // stops retrying; the event is a no-op from our perspective.
  if (meeting.status === 'completed' || meeting.status === 'failed') {
    log.info(
      { botId, event: parsed.event, currentStatus: meeting.status },
      'ignoring_event_terminal_status',
    );
    return Response.json(
      { ok: true, reason: 'terminal_status', status: meeting.status },
      { status: 200 },
    );
  }

  // Promotion to `completed` is owned by the meeting-finalize worker — it
  // generates the summary, records minutes, then flips the status. The
  // status webhook must NOT short-circuit that path by setting `completed`
  // from a `bot.status_change` carrying a `done`/`analysis_done` code,
  // because the finalize worker checks `status === 'completed'` and
  // exits early. Cap status_change promotions at `processing`.
  //
  // We also defensively enqueue finalize when we see `done`/`analysis_done`
  // via status_change in case the separate `bot.call_ended` event was
  // dropped (Recall has shipped both shapes historically).
  const finalizeSignal =
    parsed.event === 'bot.call_ended' ||
    (parsed.event === 'bot.status_change' &&
      (code === 'done' || code === 'analysis_done' || mappedStatus === 'completed'));
  // Only enqueue finalize once. If we're already `processing`, an earlier
  // event already kicked off the job and the BullMQ retry policy + the
  // worker's `status === 'completed'` short-circuit handle the rest.
  const shouldEnqueueFinalize = finalizeSignal && meeting.status !== 'processing';

  try {
    if (parsed.event === 'bot.status_change' && mappedStatus) {
      // Cap at `processing` — never promote to `completed` here.
      const cappedStatus = mappedStatus === 'completed' ? 'processing' : mappedStatus;
      // Don't regress: if we're already at `processing`, a late event
      // mapping to `joining` or `active` would pull us backwards. The
      // forward order is joining → active → processing; a status_change
      // arriving below the current state is informational only.
      // Linear status rank used only to detect backwards transitions.
      // `completed` and `failed` are unreachable here (the terminal guard
      // at the top of the handler short-circuits), but included for
      // completeness so the lookup is total.
      const rank: Record<string, number> = {
        pending: 0,
        joining: 1,
        active: 2,
        processing: 3,
        completed: 4,
        failed: 4,
      };
      const currentRank = rank[meeting.status] ?? 0;
      const nextRank = rank[cappedStatus] ?? 0;
      if (nextRank >= currentRank) {
        const patch: Parameters<typeof scope.updateMeetingStatus>[2] = {
          metadata: { last_status: code, last_status_at: createdAt ?? new Date().toISOString() },
        };
        if (cappedStatus === 'active')
          patch.startedAt = createdAt ? new Date(createdAt) : new Date();
        if (cappedStatus === 'processing')
          patch.endedAt = createdAt ? new Date(createdAt) : new Date();
        await scope.updateMeetingStatus(meeting.id, cappedStatus, patch);
      } else {
        log.info(
          { botId, currentStatus: meeting.status, attempted: cappedStatus },
          'ignoring_backward_status_transition',
        );
      }
    } else if (parsed.event === 'bot.call_ended') {
      // Only update if we haven't already moved to processing (idempotent
      // re-delivery).
      if (meeting.status !== 'processing') {
        await scope.updateMeetingStatus(meeting.id, 'processing', {
          endedAt: createdAt ? new Date(createdAt) : new Date(),
          metadata: { call_ended_at: createdAt ?? new Date().toISOString() },
        });
      }
    } else if (parsed.event === 'bot.fatal' || parsed.event === 'bot.failed') {
      // `failed` is terminal — overrides any in-flight state including
      // `processing`. The terminal guard above only blocks transitions OUT
      // of failed/completed; transitioning INTO failed is always allowed.
      await scope.updateMeetingStatus(meeting.id, 'failed', {
        metadata: { failure_at: new Date().toISOString(), failure_code: code ?? 'unknown' },
      });
    }
    // Unknown events are intentionally ignored — Recall ships new event
    // types regularly and we don't want 5xx to trigger retry storms.

    if (shouldEnqueueFinalize) {
      if (!env.REDIS_URL) {
        // Without Redis we cannot run finalize and the meeting would be
        // stuck in `processing` forever. Return 503 so Recall retries the
        // webhook with exponential backoff; by then Redis should be back.
        log.error({ meetingId: meeting.id }, 'redis_unavailable_cannot_enqueue_finalize');
        return Response.json({ ok: false, reason: 'redis_unavailable' }, { status: 503 });
      }
      await queue.enqueueMeetingFinalizeJob({
        meetingId: meeting.id,
        teamId: meeting.teamId,
      });
    }
  } catch (err) {
    log.error({ err, botId, event: parsed.event }, 'status_handler_error');
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
