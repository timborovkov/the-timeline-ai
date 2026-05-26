import {
  calendarEventEntities,
  calendarEvents,
  type Db,
  rawEvents,
  teamCalendarSettings,
} from '@timeline/db';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import { enqueueCalendarEventEmbedJob } from '../queue/queues.js';

type Visibility = 'private' | 'team' | 'specific_users';
type CalendarEventSource = 'internal' | 'google' | 'caldav';
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

export interface CalendarScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
}

export interface CalendarEventRow {
  id: string;
  teamId: string;
  createdByUserId: string | null;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  visibility: Visibility;
  visibilityUserIds: string[] | null;
  recurringParentId: string | null;
  originalStartAt: Date | null;
  isException: boolean;
  rrule: string | null;
  reminderMinutes: number | null;
  source: CalendarEventSource;
  externalCalendarId: string | null;
  externalEventId: string | null;
  agentSuggested: boolean;
  metadata: Record<string, unknown>;
  scheduledRawEventId: string | null;
  startAtRawEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CalendarEventWithRedaction extends CalendarEventRow {
  redacted: boolean;
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string | null;
  startAt: Date;
  endAt: Date;
  timezone?: string;
  allDay?: boolean;
  location?: string | null;
  visibility?: Visibility;
  visibilityUserIds?: string[] | null;
  reminderMinutes?: number | null;
  agentSuggested?: boolean;
  linkedEntityIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCalendarEventInput {
  title?: string;
  description?: string | null;
  startAt?: Date;
  endAt?: Date;
  timezone?: string;
  allDay?: boolean;
  location?: string | null;
  visibility?: Visibility;
  visibilityUserIds?: string[] | null;
  reminderMinutes?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ListCalendarEventsInput {
  from?: Date;
  to?: Date;
  limit?: number;
  includeDeleted?: boolean;
}

async function insertCalendarRawEvents(
  tx: DbOrTx,
  args: {
    teamId: string;
    userId: string;
    calendarEventId: string;
    title: string;
    startAt: Date;
    visibility: Visibility;
    visibilityUserIds: string[] | null;
  },
): Promise<{ scheduledRawEventId: string; startAtRawEventId: string }> {
  const baseMetadata = {
    calendar_event_id: args.calendarEventId,
  };

  const [scheduledRow] = await tx
    .insert(rawEvents)
    .values({
      teamId: args.teamId,
      authorUserId: args.userId,
      source: 'calendar',
      contentText: `Scheduled: ${args.title}`,
      occurredAt: new Date(),
      visibility: args.visibility,
      visibilityUserIds: args.visibilityUserIds,
      sourceMetadata: { ...baseMetadata, action: 'scheduled' },
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
      contentText: args.title,
      occurredAt: args.startAt,
      visibility: args.visibility,
      visibilityUserIds: args.visibilityUserIds,
      sourceMetadata: { ...baseMetadata, action: 'event' },
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

  return {
    scheduledRawEventId: scheduledId ?? '',
    startAtRawEventId: startAtId ?? '',
  };
}

export function createCalendarScope(deps: CalendarScopeDeps) {
  const { db, teamId, userId, ensureMember } = deps;

  const calendarVisibility = sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.createdByUserId} = ${userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND ${userId}::uuid = ANY(${calendarEvents.visibilityUserIds}))
  )`;

  function redactIfNeeded(row: CalendarEventRow): CalendarEventWithRedaction {
    if (row.visibility === 'private' && row.createdByUserId !== userId) {
      return {
        ...row,
        title: 'Busy',
        description: null,
        location: null,
        metadata: {},
        redacted: true,
      };
    }
    return { ...row, redacted: false };
  }

  return {
    async createCalendarEvent(
      input: CreateCalendarEventInput,
    ): Promise<CalendarEventWithRedaction> {
      await ensureMember();
      if (input.endAt <= input.startAt) {
        throw new Error('End time must be after start time');
      }

      return db.transaction(async (tx) => {
        const vis = input.visibility ?? 'team';
        const visUserIds = input.visibilityUserIds ?? null;

        const [row] = await tx
          .insert(calendarEvents)
          .values({
            teamId,
            createdByUserId: userId,
            title: input.title,
            description: input.description ?? null,
            startAt: input.startAt,
            endAt: input.endAt,
            timezone: input.timezone ?? 'UTC',
            allDay: input.allDay ?? false,
            location: input.location ?? null,
            visibility: vis,
            visibilityUserIds: visUserIds,
            reminderMinutes: input.reminderMinutes ?? null,
            agentSuggested: input.agentSuggested ?? false,
            metadata: input.metadata ?? {},
          })
          .returning();

        if (!row) throw new Error('Failed to create calendar event');

        const { scheduledRawEventId, startAtRawEventId } = await insertCalendarRawEvents(tx, {
          teamId,
          userId,
          calendarEventId: row.id,
          title: input.title,
          startAt: input.startAt,
          visibility: vis,
          visibilityUserIds: visUserIds,
        });

        await tx
          .update(calendarEvents)
          .set({ scheduledRawEventId, startAtRawEventId })
          .where(eq(calendarEvents.id, row.id));

        if (input.linkedEntityIds && input.linkedEntityIds.length > 0) {
          await tx.insert(calendarEventEntities).values(
            input.linkedEntityIds.map((entityId) => ({
              calendarEventId: row.id,
              entityId,
              teamId,
            })),
          );
        }

        const updated = {
          ...(row as CalendarEventRow),
          scheduledRawEventId,
          startAtRawEventId,
        };

        await enqueueCalendarEventEmbedJob(teamId, row.id);

        return redactIfNeeded(updated);
      });
    },

    async getCalendarEvent(id: string): Promise<CalendarEventWithRedaction | null> {
      await ensureMember();
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, id),
            eq(calendarEvents.teamId, teamId),
            isNull(calendarEvents.deletedAt),
            calendarVisibility,
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return redactIfNeeded(row as CalendarEventRow);
    },

    async listCalendarEvents(
      opts: ListCalendarEventsInput = {},
    ): Promise<CalendarEventWithRedaction[]> {
      await ensureMember();
      const conditions = [eq(calendarEvents.teamId, teamId), calendarVisibility];

      if (!opts.includeDeleted) {
        conditions.push(isNull(calendarEvents.deletedAt));
      }
      if (opts.from) {
        conditions.push(gte(calendarEvents.endAt, opts.from));
      }
      if (opts.to) {
        conditions.push(lt(calendarEvents.startAt, opts.to));
      }

      const rows = await db
        .select()
        .from(calendarEvents)
        .where(and(...conditions))
        .orderBy(asc(calendarEvents.startAt))
        .limit(opts.limit ?? 200);

      return (rows as CalendarEventRow[]).map(redactIfNeeded);
    },

    async updateCalendarEvent(
      id: string,
      patch: UpdateCalendarEventInput,
    ): Promise<CalendarEventWithRedaction | null> {
      await ensureMember();

      return db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, id),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarVisibility,
            ),
          )
          .limit(1);

        const row = existing[0];
        if (!row) return null;

        const setClause: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.title !== undefined) setClause.title = patch.title;
        if (patch.description !== undefined) setClause.description = patch.description;
        if (patch.startAt !== undefined) setClause.startAt = patch.startAt;
        if (patch.endAt !== undefined) setClause.endAt = patch.endAt;
        if (patch.timezone !== undefined) setClause.timezone = patch.timezone;
        if (patch.allDay !== undefined) setClause.allDay = patch.allDay;
        if (patch.location !== undefined) setClause.location = patch.location;
        if (patch.visibility !== undefined) setClause.visibility = patch.visibility;
        if (patch.visibilityUserIds !== undefined)
          setClause.visibilityUserIds = patch.visibilityUserIds;
        if (patch.reminderMinutes !== undefined) setClause.reminderMinutes = patch.reminderMinutes;
        if (patch.metadata !== undefined) {
          setClause.metadata = patch.metadata;
        }

        const [updated] = await tx
          .update(calendarEvents)
          .set(setClause)
          .where(eq(calendarEvents.id, id))
          .returning();

        if (!updated) return null;

        if (patch.startAt && row.startAtRawEventId) {
          await tx
            .update(rawEvents)
            .set({
              occurredAt: patch.startAt,
              contentText: patch.title ?? row.title,
            })
            .where(eq(rawEvents.id, row.startAtRawEventId));
        }

        await tx.insert(rawEvents).values({
          teamId,
          authorUserId: userId,
          source: 'calendar',
          contentText: `Updated: ${patch.title ?? row.title}`,
          occurredAt: new Date(),
          visibility: patch.visibility ?? row.visibility,
          visibilityUserIds: patch.visibilityUserIds ?? row.visibilityUserIds,
          sourceMetadata: {
            calendar_event_id: id,
            action: 'updated',
          },
        });

        await enqueueCalendarEventEmbedJob(teamId, id);

        return redactIfNeeded(updated as CalendarEventRow);
      });
    },

    async deleteCalendarEvent(id: string): Promise<boolean> {
      await ensureMember();

      return db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, id),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarVisibility,
            ),
          )
          .limit(1);

        const row = existing[0];
        if (!row) return false;

        await tx
          .update(calendarEvents)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(calendarEvents.id, id));

        if (row.startAtRawEventId) {
          const tombstone = JSON.stringify({ deleted: true });
          await tx
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${tombstone}::jsonb`,
            })
            .where(eq(rawEvents.id, row.startAtRawEventId));
        }

        await tx.insert(rawEvents).values({
          teamId,
          authorUserId: userId,
          source: 'calendar',
          contentText: `Cancelled: ${row.title}`,
          occurredAt: new Date(),
          visibility: row.visibility,
          visibilityUserIds: row.visibilityUserIds,
          sourceMetadata: {
            calendar_event_id: id,
            action: 'cancelled',
          },
        });

        return true;
      });
    },

    async linkEntity(
      calendarEventId: string,
      entityId: string,
      relationshipType = 'related',
    ): Promise<void> {
      await ensureMember();
      await db
        .insert(calendarEventEntities)
        .values({ calendarEventId, entityId, teamId, relationshipType })
        .onConflictDoNothing();
    },

    async unlinkEntity(calendarEventId: string, entityId: string): Promise<void> {
      await ensureMember();
      await db
        .delete(calendarEventEntities)
        .where(
          and(
            eq(calendarEventEntities.calendarEventId, calendarEventId),
            eq(calendarEventEntities.entityId, entityId),
            eq(calendarEventEntities.teamId, teamId),
          ),
        );
    },

    async getLinkedEntities(calendarEventId: string) {
      await ensureMember();
      return db
        .select()
        .from(calendarEventEntities)
        .where(
          and(
            eq(calendarEventEntities.calendarEventId, calendarEventId),
            eq(calendarEventEntities.teamId, teamId),
          ),
        )
        .orderBy(asc(calendarEventEntities.createdAt));
    },

    async getCalendarSettings() {
      await ensureMember();
      const rows = await db
        .select()
        .from(teamCalendarSettings)
        .where(eq(teamCalendarSettings.teamId, teamId))
        .limit(1);
      if (rows[0]) return rows[0];
      return {
        teamId,
        defaultReminderMinutes: 15,
        defaultVisibility: 'team' as const,
        updatedAt: new Date(),
      };
    },

    async upsertCalendarSettings(patch: {
      defaultReminderMinutes?: number;
      defaultVisibility?: Visibility;
    }) {
      await ensureMember('admin');
      const insertValues: Record<string, unknown> = {
        teamId,
        updatedAt: new Date(),
      };
      if (patch.defaultReminderMinutes !== undefined) {
        insertValues.defaultReminderMinutes = patch.defaultReminderMinutes;
      }
      if (patch.defaultVisibility !== undefined) {
        insertValues.defaultVisibility = patch.defaultVisibility;
      }
      const setClause: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(insertValues)) {
        if (k !== 'teamId') setClause[k] = insertValues[k];
      }
      await db
        .insert(teamCalendarSettings)
        .values(insertValues as typeof teamCalendarSettings.$inferInsert)
        .onConflictDoUpdate({ target: teamCalendarSettings.teamId, set: setClause });
    },
  };
}

export type CalendarScope = ReturnType<typeof createCalendarScope>;
