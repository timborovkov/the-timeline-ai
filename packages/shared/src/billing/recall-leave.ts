import { meetings, type Db } from '@timeline/db';
import { and, inArray, isNotNull } from 'drizzle-orm';

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

/** Durable fallback if Recall ignores in_call_recording_timeout. */
export async function leaveOverdueRecallBots(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(meetings)
    .where(
      and(inArray(meetings.status, ['joining', 'active']), isNotNull(meetings.providerBotId)),
    );
  let left = 0;
  for (const meeting of rows) {
    const reservedMinutes = reservedMinutesFromMetadata(meeting.metadata);
    if (reservedMinutes === null || !meeting.providerBotId) continue;
    const started = meeting.startedAt ?? meeting.createdAt;
    if (Date.now() - started.getTime() < reservedMinutes * 60_000) continue;
    try {
      const provider = getMeetingBotProvider(meeting.provider);
      await provider.leaveMeeting(meeting.providerBotId);
      left += 1;
    } catch (err) {
      log.warn({ err, meetingId: meeting.id }, 'overdue recall leave failed');
    }
  }
  return left;
}