import { releaseRecallMeetingMinutes } from '@timeline/shared/billing';
import { getEnv } from '@timeline/shared/env';
import { childLogger } from '@timeline/shared/logger';
import * as meetingBots from '@timeline/shared/meeting-bots';
import * as meetingsScope from '@timeline/shared/meetings';
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

const log = childLogger('web:api:recall:status');
const MEETING_STATUS_RANK: Record<string, number> = {
  pending: 0,
  scheduled: 0,
  joining: 1,
  active: 2,
  processing: 3,
  completed: 4,
  completed_partial: 4,
  failed: 4,
  skipped: 4,
  no_show: 4,
  cancelled: 4,
};

const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_partial',
  'failed',
  'skipped',
  'no_show',
  'cancelled',
]);

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
          metadata: z.record(z.string(), z.unknown()).optional(),
          status: z
            .object({
              code: z.string().optional(),
              created_at: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
      data: z
        .object({
          code: z.string().optional(),
          sub_code: z.string().nullable().optional(),
          updated_at: z.string().optional(),
        })
        .loose()
        .optional(),
      status: z
        .object({
          code: z.string().optional(),
          created_at: z.string().optional(),
        })
        .optional(),
    })
    .loose(),
});

function statusCodeFromEvent(event: string): string | null {
  if (!event.startsWith('bot.') && !event.startsWith('transcript.')) return null;
  const code = event.split('.')[1];
  if (!code) return null;
  return code;
}

function isNoShowCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const normalized = code.toLowerCase();
  return (
    normalized.includes('waiting_room_timeout') ||
    normalized.includes('timeout_exceeded_waiting_room') ||
    normalized.includes('noone_joined') ||
    normalized.includes('no_one_joined') ||
    normalized.includes('no-one-joined')
  );
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  if (!env.RECALL_STATUS_WEBHOOK_SECRET) {
    reportHandledEvent({
      message: 'recall_status_webhook_disabled',
      surface: 'api',
      operation: 'recall_status_config',
      level: 'warning',
      tags: { reason: 'webhook_disabled' },
    });
    return Response.json({ ok: false, reason: 'webhook_disabled' }, { status: 503 });
  }

  const bodyResult = await readCappedTextBody(req, REQUEST_BODY_LIMITS.integrationWebhook);
  if (bodyResult.tooLarge) return payloadTooLargeResponse();
  const body = bodyResult.text;
  const verify = meetingBots.verifySvixSignature({
    body,
    headers: req.headers,
    secret: env.RECALL_STATUS_WEBHOOK_SECRET,
  });
  if (!verify.ok) {
    log.warn({ reason: verify.reason }, 'svix_verification_failed');
    reportHandledEvent({
      message: 'recall_status_svix_verification_failed',
      surface: 'api',
      operation: 'recall_status_svix_verification',
      level: 'warning',
      tags: {
        reason: verify.reason,
        has_svix_id: req.headers.has('svix-id') || req.headers.has('webhook-id'),
        has_svix_timestamp:
          req.headers.has('svix-timestamp') || req.headers.has('webhook-timestamp'),
        has_svix_signature:
          req.headers.has('svix-signature') || req.headers.has('webhook-signature'),
      },
    });
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 401 });
  }

  let parsed: z.infer<typeof statusEventSchema>;
  try {
    parsed = statusEventSchema.parse(JSON.parse(body));
  } catch (err) {
    log.warn({ err }, 'invalid_payload');
    reportHandledEvent({
      message: 'recall_status_invalid_payload',
      surface: 'api',
      operation: 'recall_status_parse',
      level: 'warning',
      tags: { reason: 'invalid_payload' },
    });
    return Response.json({ ok: true, reason: 'invalid_payload' }, { status: 200 });
  }

  const botId = parsed.data.bot?.id;
  if (!botId) {
    return Response.json({ ok: true, reason: 'no_bot_id' }, { status: 200 });
  }

  // Resolve the meeting by bot id only — no team scope, this is the
  // webhook's authoritative lookup. See lookupMeetingByBotId for the
  // rationale.
  const meeting = await meetingsScope.lookupMeetingByBotId(db, botId);
  if (!meeting) {
    log.warn({ botId, event: parsed.event }, 'meeting_not_found_for_bot');
    return Response.json({ ok: true, reason: 'meeting_not_found' }, { status: 200 });
  }

  // System scope: use createdByUserId so visibility-aware reads work.
  // updateMeetingStatus itself doesn't go through ensureMember.
  const scope = withTeam(db, meeting.teamId, meeting.createdByUserId ?? meeting.teamId);

  const code =
    parsed.data.data?.code ??
    parsed.data.status?.code ??
    parsed.data.bot?.status?.code ??
    statusCodeFromEvent(parsed.event);
  const subCode = parsed.data.data?.sub_code;
  const createdAt =
    parsed.data.bot?.status?.created_at ??
    parsed.data.status?.created_at ??
    parsed.data.data?.updated_at;
  const mappedStatus = code ? meetingBots.recallMapStatus(code) : null;

  // Terminal-state guard. `completed` (finalize ran) and `failed` (user
  // cancelled or bot crashed) are absorbing states — Recall can replay
  // status events well after the meeting reached terminal, and we must
  // not let a late `bot.status_change` regress them to `processing` or
  // re-enqueue finalize over a cancelled meeting. Return 200 so Recall
  // stops retrying; the event is a no-op from our perspective.
  if (TERMINAL_STATUSES.has(meeting.status)) {
    if (meeting.status !== 'completed' && meeting.status !== 'completed_partial') {
      await releaseRecallMeetingMinutes(scope.billing, { meetingId: meeting.id }).catch(
        () => undefined,
      );
    }
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
  const isFailureEvent =
    parsed.event === 'bot.fatal' || parsed.event === 'bot.failed' || mappedStatus === 'failed';
  const noShowCode = isNoShowCode(subCode) ? subCode : isNoShowCode(code) ? code : null;
  const isNoShowEvent = noShowCode !== null;
  const shouldEnqueueFinalize =
    !isFailureEvent &&
    !isNoShowEvent &&
    (parsed.event === 'bot.call_ended' ||
      parsed.event === 'bot.done' ||
      parsed.event === 'transcript.done' ||
      (parsed.event === 'bot.status_change' &&
        (code === 'done' || code === 'analysis_done' || mappedStatus === 'completed')));

  // Fail-fast Redis precheck. If we can't enqueue finalize, we must NOT
  // write `processing` to the DB and then return 503 — Recall will retry
  // the webhook, but on the next attempt the meeting is already
  // `processing` so any "did we already enqueue?" guard would silently
  // skip the enqueue and the meeting would be stranded. Returning 503
  // BEFORE the DB write keeps the status at its prior value (active /
  // joining) so the next retry re-enters this branch cleanly.
  if (shouldEnqueueFinalize && !env.REDIS_URL) {
    log.error({ meetingId: meeting.id }, 'redis_unavailable_cannot_enqueue_finalize');
    reportCaughtError(new Error('redis_unavailable_cannot_enqueue_finalize'), {
      surface: 'api',
      operation: 'recall_status_enqueue_finalize',
    });
    return Response.json({ ok: false, reason: 'redis_unavailable' }, { status: 503 });
  }

  try {
    let shouldFinalizeCurrentAttempt = false;
    if (isNoShowEvent) {
      const noShowOutcome = await scope.meetings.handleMeetingNoShow({
        meetingId: meeting.id,
        providerBotId: botId,
        code: noShowCode ?? 'unknown',
        endedAt: createdAt ? new Date(createdAt) : new Date(),
      });
      if (noShowOutcome === 'retry_scheduled') {
        await releaseRecallMeetingMinutes(scope.billing, { meetingId: meeting.id }).catch(
          () => undefined,
        );
        try {
          const queue = await requireRedisQueue();
          await queue.enqueueMeetingSchedulerTick();
        } catch (err) {
          log.warn({ err, meetingId: meeting.id }, 'no_show_retry_enqueue_failed');
          reportCaughtError(err, {
            surface: 'api',
            operation: 'recall_status_enqueue_no_show_retry',
          });
        }
      } else if (noShowOutcome === 'terminal') {
        await releaseRecallMeetingMinutes(scope.billing, { meetingId: meeting.id }).catch(
          () => undefined,
        );
      }
    } else if (isFailureEvent) {
      await scope.meetings.handleMeetingFailure({
        meetingId: meeting.id,
        providerBotId: botId,
        code: code ?? 'unknown',
        failedAt: createdAt ? new Date(createdAt) : new Date(),
      });
      await releaseRecallMeetingMinutes(scope.billing, { meetingId: meeting.id }).catch(
        () => undefined,
      );
    } else if (shouldEnqueueFinalize) {
      shouldFinalizeCurrentAttempt = await scope.meetings.updateMeetingStatusForBot(
        meeting.id,
        botId,
        'processing',
        {
          endedAt: createdAt ? new Date(createdAt) : new Date(),
          metadata: {
            last_status: code ?? 'call_ended',
            last_status_at: createdAt ?? new Date().toISOString(),
          },
        },
      );
    } else if (mappedStatus) {
      // Cap at `processing` — never promote to `completed` here.
      const cappedStatus = mappedStatus === 'completed' ? 'processing' : mappedStatus;
      // Don't regress: if we're already at `processing`, a late event
      // mapping to `joining` or `active` would pull us backwards. The
      // forward order is joining → active → processing; a status_change
      // arriving below the current state is informational only.
      // Linear status rank used only to detect backwards transitions.
      // `completed` and `failed` are unreachable here (the terminal guard
      // at the top of the handler short-circuits), but included in
      // MEETING_STATUS_RANK so the lookup is total.
      const currentRank = MEETING_STATUS_RANK[meeting.status] ?? 0;
      const nextRank = MEETING_STATUS_RANK[cappedStatus] ?? 0;
      if (nextRank >= currentRank) {
        const patch: Parameters<typeof scope.meetings.updateMeetingStatus>[2] = {
          metadata: { last_status: code, last_status_at: createdAt ?? new Date().toISOString() },
        };
        if (cappedStatus === 'active')
          patch.startedAt = createdAt ? new Date(createdAt) : new Date();
        if (cappedStatus === 'processing')
          patch.endedAt = createdAt ? new Date(createdAt) : new Date();
        await scope.meetings.updateMeetingStatusForBot(meeting.id, botId, cappedStatus, patch);
      } else {
        log.info(
          { botId, currentStatus: meeting.status, attempted: cappedStatus },
          'ignoring_backward_status_transition',
        );
      }
    }
    // Unknown events are intentionally ignored — Recall ships new event
    // types regularly and we don't want 5xx to trigger retry storms.

    if (shouldEnqueueFinalize && shouldFinalizeCurrentAttempt) {
      // Redis availability was verified before any DB write above.
      // Duplicate enqueues (e.g. retried bot.call_ended after our 200) are
      // safe: the worker short-circuits on `status === 'completed'`, so
      // the cost of a duplicate is a single DB lookup.
      const queue = await requireRedisQueue();
      await queue.enqueueMeetingFinalizeJob({
        meetingId: meeting.id,
        teamId: meeting.teamId,
      });
    }
  } catch (err) {
    log.error({ err, botId, event: parsed.event }, 'status_handler_error');
    reportCaughtError(err, { surface: 'api', operation: 'recall_status_handler' });
    return Response.json({ ok: false, reason: 'handler_error' }, { status: 503 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
