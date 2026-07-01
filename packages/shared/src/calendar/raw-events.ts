import { type Db, rawEvents } from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import {
  reconcileLinkArtifactsForRawEvent,
  refreshLinkArtifactsForRawEvent,
} from '#src/conversational/link-artifacts.js';
import { childLogger } from '#src/logger.js';
import { normalizeRawEventsToEvidence } from '#src/reconciliation/normalization.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
const log = childLogger('calendar:raw-events');

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

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function sourceMetadataReplacingConversationArtifacts(
  metadata: unknown,
  text: string | null | undefined,
): Record<string, unknown> {
  const base = recordFromUnknown(metadata);
  delete base.links;
  delete base.contacts;
  return sourceMetadataWithConversationArtifacts(base, text);
}

async function updateCalendarRawEventText(
  tx: DbOrTx,
  args: {
    rawEventId: string;
    contentText: string;
    occurredAt?: Date;
  },
): Promise<void> {
  const [existing] = await tx
    .select({
      teamId: rawEvents.teamId,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(eq(rawEvents.id, args.rawEventId))
    .limit(1);
  if (!existing) return;

  await tx
    .update(rawEvents)
    .set({
      contentText: args.contentText,
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
      sourceMetadata: sourceMetadataReplacingConversationArtifacts(
        existing.sourceMetadata,
        args.contentText,
      ),
    })
    .where(eq(rawEvents.id, args.rawEventId));
  await refreshLinkArtifactsForRawEvent(tx, {
    teamId: existing.teamId,
    rawEventId: args.rawEventId,
    text: args.contentText,
    occurredAt: args.occurredAt ?? null,
  });
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

  const rawEventIds = [scheduledId, startAtId].filter((id): id is string => Boolean(id));
  await normalizeCalendarRawEventIds(tx, { teamId: args.teamId, rawEventIds });
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
    teamId: string;
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
    await updateCalendarRawEventText(tx, {
      rawEventId: args.startAtRawEventId,
      contentText: buildCalendarTimelineText(args),
      occurredAt: args.startAt,
    });
  }

  if (args.scheduledRawEventId) {
    await updateCalendarRawEventText(tx, {
      rawEventId: args.scheduledRawEventId,
      contentText: `Scheduled: ${args.title}`,
    });
  }

  await normalizeCalendarRawEventIds(tx, {
    teamId: args.teamId,
    rawEventIds: linkedRawEventIds,
  });
}

export async function normalizeCalendarRawEventIds(
  db: DbOrTx,
  args: { teamId: string; rawEventIds: string[] },
): Promise<void> {
  const rawEventIds = uniqueIds(args.rawEventIds.filter((id) => id.length > 0));
  if (rawEventIds.length === 0) return;
  try {
    await normalizeRawEventsToEvidence({ db, teamId: args.teamId, rawEventIds });
  } catch (err) {
    log.warn(
      { err, teamId: args.teamId, rawEventIds },
      'calendar reconciliation evidence normalization failed',
    );
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
