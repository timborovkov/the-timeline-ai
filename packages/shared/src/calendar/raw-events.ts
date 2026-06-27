import { type Db, rawEvents } from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import { reconcileLinkArtifactsForRawEvent } from '#src/conversational/link-artifacts.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export type CalendarRawVisibility = 'private' | 'team' | 'specific_users';

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function buildCalendarTimelineText(args: {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
}): string {
  const parts = [
    args.title,
    args.description ?? '',
    args.location ? `at ${args.location}` : '',
    `${args.startAt.toISOString()} to ${args.endAt.toISOString()}`,
    args.timezone !== 'UTC' ? `(${args.timezone})` : '',
  ];
  return parts.filter((part) => part.length > 0).join(' | ');
}

export async function insertCalendarRawEvents(
  tx: DbOrTx,
  args: {
    teamId: string;
    userId: string | null;
    calendarEventId: string;
    title: string;
    description: string | null;
    startAt: Date;
    endAt: Date;
    timezone: string;
    location: string | null;
    visibility: CalendarRawVisibility;
    visibilityUserIds: string[] | null;
  },
): Promise<{ scheduledRawEventId: string; startAtRawEventId: string }> {
  const baseMetadata = {
    calendar_event_id: args.calendarEventId,
  };
  const scheduledText = `Scheduled: ${args.title}`;
  const startText = buildCalendarTimelineText(args);

  const [scheduledRow] = await tx
    .insert(rawEvents)
    .values({
      teamId: args.teamId,
      authorUserId: args.userId,
      source: 'calendar',
      contentText: scheduledText,
      occurredAt: new Date(),
      visibility: args.visibility,
      visibilityUserIds: args.visibilityUserIds,
      visibilityOwnerUserId: args.userId,
      sourceMetadata: sourceMetadataWithConversationArtifacts(
        { ...baseMetadata, action: 'scheduled' },
        scheduledText,
      ),
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id });

  let scheduledId = scheduledRow?.id;
  if (!scheduledId) {
    const existing = await tx
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, args.teamId),
          sql`(${rawEvents.sourceMetadata} ->> 'calendar_event_id') = ${args.calendarEventId}`,
          sql`(${rawEvents.sourceMetadata} ->> 'action') = 'scheduled'`,
        ),
      )
      .limit(1);
    scheduledId = existing[0]?.id;
  }

  const [startAtRow] = await tx
    .insert(rawEvents)
    .values({
      teamId: args.teamId,
      authorUserId: args.userId,
      source: 'calendar',
      contentText: startText,
      occurredAt: args.startAt,
      visibility: args.visibility,
      visibilityUserIds: args.visibilityUserIds,
      visibilityOwnerUserId: args.userId,
      sourceMetadata: sourceMetadataWithConversationArtifacts(
        { ...baseMetadata, action: 'event' },
        startText,
      ),
    })
    .onConflictDoNothing()
    .returning({ id: rawEvents.id });

  let startAtId = startAtRow?.id;
  if (!startAtId) {
    const existing = await tx
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, args.teamId),
          sql`(${rawEvents.sourceMetadata} ->> 'calendar_event_id') = ${args.calendarEventId}`,
          sql`(${rawEvents.sourceMetadata} ->> 'action') = 'event'`,
        ),
      )
      .limit(1);
    startAtId = existing[0]?.id;
  }

  if (scheduledId) {
    await reconcileLinkArtifactsForRawEvent(tx, {
      teamId: args.teamId,
      rawEventId: scheduledId,
      text: scheduledText,
    });
  }
  if (startAtId) {
    await reconcileLinkArtifactsForRawEvent(tx, {
      teamId: args.teamId,
      rawEventId: startAtId,
      text: startText,
      occurredAt: args.startAt,
    });
  }

  return {
    scheduledRawEventId: scheduledId ?? '',
    startAtRawEventId: startAtId ?? '',
  };
}

export async function updateCalendarRawEvents(
  tx: DbOrTx,
  args: {
    scheduledRawEventId: string | null;
    startAtRawEventId: string | null;
    title: string;
    description: string | null;
    startAt: Date;
    endAt: Date;
    timezone: string;
    location: string | null;
    visibility: CalendarRawVisibility;
    visibilityUserIds: string[] | null;
  },
): Promise<void> {
  const linkedRawEventIds = [args.startAtRawEventId, args.scheduledRawEventId].filter(
    (id): id is string => id !== null && id.length > 0,
  );
  if (linkedRawEventIds.length > 0) {
    await tx
      .update(rawEvents)
      .set({
        visibility: args.visibility,
        visibilityUserIds: args.visibilityUserIds,
      })
      .where(inArray(rawEvents.id, linkedRawEventIds));
  }

  if (args.startAtRawEventId) {
    await tx
      .update(rawEvents)
      .set({
        contentText: buildCalendarTimelineText(args),
        occurredAt: args.startAt,
      })
      .where(eq(rawEvents.id, args.startAtRawEventId));
  }

  if (args.scheduledRawEventId) {
    await tx
      .update(rawEvents)
      .set({ contentText: `Scheduled: ${args.title}` })
      .where(eq(rawEvents.id, args.scheduledRawEventId));
  }
}

export async function tombstoneCalendarRawEventIds(
  tx: DbOrTx,
  rawEventIds: string[],
): Promise<void> {
  const ids = uniqueIds(rawEventIds.filter((id) => id.length > 0));
  if (ids.length === 0) return;
  const tombstone = JSON.stringify({ deleted: true });
  await tx
    .update(rawEvents)
    .set({
      sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${tombstone}::jsonb`,
    })
    .where(inArray(rawEvents.id, ids));
}
