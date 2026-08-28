import { billingUsageReservations, meetings, type Db } from '@timeline/db';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { settleElapsedRecallMeetingMinutes } from '#src/billing/admission.js';
import { BILLING_SYSTEM_USER_ID } from '#src/billing/context.js';
import { createBillingScope } from '#src/billing/scope.js';
import { childLogger } from '#src/logger.js';
import { getMeetingBotProvider } from '#src/meeting-bots/index.js';

const log = childLogger('billing:recall-leave');

function reservedMinutesFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).reserved_recall_minutes;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function pendingRecallLeaveBotId(metadata: Record<string, unknown>): string | null {
  const raw = metadata.pending_recall_leave_bot_id;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

/**
 * Clock for the reserved Recall duration. Prefer the join stamp so a
 * scheduled meeting's `createdAt` (days earlier) cannot force an immediate leave.
 * `startedAt` covers bots that became active before this stamp existed.
 */
export function recallLeaveAnchorAt(input: {
  startedAt: Date | null;
  metadata: unknown;
}): Date | null {
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    const raw = (input.metadata as Record<string, unknown>).reserved_recall_started_at;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return input.startedAt;
}

async function leavePendingRecallReservations(db: Db): Promise<number> {
  const rows = await db
    .select({
      teamId: billingUsageReservations.teamId,
      operationId: billingUsageReservations.operationId,
      metadata: billingUsageReservations.metadata,
    })
    .from(billingUsageReservations)
    .where(
      and(
        eq(billingUsageReservations.state, 'reserved'),
        eq(billingUsageReservations.meterId, 'recall_minutes'),
        sql`${billingUsageReservations.metadata}->>'pending_recall_leave_bot_id' IS NOT NULL`,
      ),
    );
  let left = 0;
  for (const row of rows) {
    const botId = pendingRecallLeaveBotId(row.metadata);
    if (!botId) continue;
    try {
      await getMeetingBotProvider('recall').leaveMeeting(botId);
    } catch (err) {
      log.warn({ err, operationId: row.operationId }, 'pending recall leave failed');
      continue;
    }
    left += 1;
    const meetingId = row.operationId.startsWith('recall:')
      ? row.operationId.slice('recall:'.length)
      : null;
    const billing = createBillingScope({
      db,
      teamId: row.teamId,
      userId: BILLING_SYSTEM_USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    if (!meetingId) {
      await billing.release(row.operationId).catch(() => undefined);
      continue;
    }
    const [meeting] = await db
      .select({
        startedAt: meetings.startedAt,
        endedAt: meetings.endedAt,
        metadata: meetings.metadata,
      })
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);
    try {
      await settleElapsedRecallMeetingMinutes(billing, {
        meetingId,
        startedAt: meeting?.startedAt ?? null,
        endedAt: meeting?.endedAt ?? new Date(),
        metadata: meeting?.metadata ?? row.metadata,
      });
    } catch (err) {
      log.warn({ err, meetingId }, 'pending recall leave settlement failed');
    }
  }
  return left;
}

/** Durable fallback if Recall ignores in_call_recording_timeout. */
export async function leaveOverdueRecallBots(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(meetings)
    .where(and(inArray(meetings.status, ['joining', 'active']), isNotNull(meetings.providerBotId)));
  let left = 0;
  for (const meeting of rows) {
    const reservedMinutes = reservedMinutesFromMetadata(meeting.metadata);
    if (reservedMinutes === null || !meeting.providerBotId) continue;
    const started = recallLeaveAnchorAt({
      startedAt: meeting.startedAt,
      metadata: meeting.metadata,
    });
    if (!started) continue;
    if (Date.now() - started.getTime() < reservedMinutes * 60_000) continue;
    try {
      const provider = getMeetingBotProvider(meeting.provider);
      await provider.leaveMeeting(meeting.providerBotId);
      left += 1;
    } catch (err) {
      log.warn({ err, meetingId: meeting.id }, 'overdue recall leave failed');
    }
  }
  left += await leavePendingRecallReservations(db);
  return left;
}
