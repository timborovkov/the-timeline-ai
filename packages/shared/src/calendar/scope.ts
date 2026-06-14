import {
  calendarEventEntities,
  calendarEvents,
  type Db,
  entities,
  rawEvents,
  teamCalendarSettings,
} from '@timeline/db';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  expandRRuleBetween,
  recurrenceWindowFrom,
  rruleForSplit,
  rruleUntil,
  validateRRule,
} from '#src/calendar/recurrence.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { childLogger } from '#src/logger.js';
import { getQdrantClient } from '#src/qdrant/client.js';
import { buildPointId } from '#src/qdrant/point-id.js';
import { enqueueCalendarEventEmbedJob } from '#src/queue/queues.js';
import { validateVisibilityUserIds } from '#src/visibility.js';

type Visibility = 'private' | 'team' | 'specific_users';
type CalendarShowAs = 'busy' | 'free' | 'tentative';
type CalendarEventSource = 'internal' | 'google' | 'caldav';
type RecurrenceEditMode = 'single' | 'series' | 'this_and_future';
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type CalendarQdrantAction = 'embed' | 'delete' | null;

const log = childLogger('calendar:scope');

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
  showAs?: CalendarShowAs;
  rrule?: string | null;
  recurringParentId?: string | null;
  originalStartAt?: Date | null;
  isException?: boolean;
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
  showAs?: CalendarShowAs;
  rrule?: string | null;
  recurrenceEditMode?: RecurrenceEditMode;
  metadata?: Record<string, unknown>;
}

export interface CalendarEventUpdateResult extends CalendarEventWithRedaction {
  changedFields: (keyof UpdateCalendarEventInput)[];
}

export interface ListCalendarEventsInput {
  from?: Date;
  to?: Date;
  limit?: number;
  includeDeleted?: boolean;
}

export interface MaterializeRecurringEventsInput {
  from?: Date;
  to?: Date;
  parentId?: string;
}

async function insertCalendarRawEvents(
  tx: DbOrTx,
  args: {
    teamId: string;
    userId: string;
    calendarEventId: string;
    title: string;
    description: string | null;
    startAt: Date;
    endAt: Date;
    timezone: string;
    location: string | null;
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
      visibilityOwnerUserId: args.userId,
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
      contentText: buildCalendarTimelineText(args),
      occurredAt: args.startAt,
      visibility: args.visibility,
      visibilityUserIds: args.visibilityUserIds,
      visibilityOwnerUserId: args.userId,
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

function buildCalendarTimelineText(args: {
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
  return parts.filter((p) => p.length > 0).join(' | ');
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

function sameStringArray(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameJson(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function assertEntitiesBelongToTeam(
  tx: DbOrTx,
  args: { teamId: string; entityIds: string[] },
): Promise<string[]> {
  const entityIds = uniqueIds(args.entityIds);
  if (entityIds.length === 0) return [];

  const rows = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.teamId, args.teamId), inArray(entities.id, entityIds)));

  if (rows.length !== entityIds.length) {
    throw new Error('One or more linked entities were not found');
  }

  return entityIds;
}

function showAsOrDefault(showAs: string | null | undefined): CalendarShowAs {
  return showAs === 'free' || showAs === 'tentative' ? showAs : 'busy';
}

function eventMetadata(row: Pick<CalendarEventRow, 'metadata'>): Record<string, unknown> {
  return row.metadata;
}

function mergeMetadata(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...patch };
}

async function deleteCalendarEventPoints(teamId: string, eventId: string): Promise<void> {
  try {
    const client = getQdrantClient();
    const activeModel = TIMELINE_MODELS.embedding.id;
    const models = uniqueIds([activeModel, 'openai/text-embedding-3-small']);
    for (const model of models) {
      await client.deletePointsForSource({
        teamId,
        scope: 'calendar_event',
        sourceId: eventId,
        model,
      });
    }
    await client.deletePoints(models.map((m) => buildPointId('calendar_event', eventId, m)));
  } catch {
    // Calendar deletion should not fail just because semantic search cleanup
    // is temporarily unavailable. The embed coverage/reembed scripts can
    // reconcile stale points later.
  }
}

async function enqueueCalendarEventEmbedding(teamId: string, eventId: string): Promise<void> {
  try {
    await enqueueCalendarEventEmbedJob(teamId, eventId);
  } catch (err) {
    // Calendar writes are durable even when Redis/search indexing is
    // temporarily unavailable. Re-embed/backfill jobs can reconcile later.
    log.warn({ err, teamId, eventId }, 'calendar embed enqueue failed');
  }
}

export function createCalendarScope(deps: CalendarScopeDeps) {
  const { db, teamId, userId, ensureMember, requireTeamMember } = deps;

  // Read visibility: returns ALL private events (any user) so the
  // application layer can redact them to "Busy" blocks. Without this,
  // private events are filtered out entirely and teammates see no
  // busy block at all.
  const calendarReadVisibility = sql`(
    ${calendarEvents.visibility} = 'team'
    OR ${calendarEvents.visibility} = 'private'
    OR ${calendarEvents.createdByUserId} = ${userId}::uuid
    OR (${calendarEvents.visibility} = 'specific_users' AND ${userId}::uuid = ANY(${calendarEvents.visibilityUserIds}))
  )`;

  // Write visibility: only the creator or explicitly-listed users can
  // modify/delete. Other users' private events are read-only (busy blocks).
  const calendarWriteVisibility = sql`(
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

  async function insertOccurrence(
    tx: DbOrTx,
    parent: CalendarEventRow,
    occurrenceStart: Date,
  ): Promise<string | null> {
    if (sameDate(occurrenceStart, parent.startAt)) return parent.id;
    const durationMs = parent.endAt.getTime() - parent.startAt.getTime();
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
    const [existing] = await tx
      .select({
        id: calendarEvents.id,
        deletedAt: calendarEvents.deletedAt,
        isException: calendarEvents.isException,
      })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          eq(calendarEvents.recurringParentId, parent.id),
          eq(calendarEvents.originalStartAt, occurrenceStart),
        ),
      )
      .limit(1);
    if (existing?.isException || (existing && !existing.deletedAt)) return existing.id;

    const [row] = await tx
      .insert(calendarEvents)
      .values({
        teamId,
        createdByUserId: parent.createdByUserId,
        title: parent.title,
        description: parent.description,
        startAt: occurrenceStart,
        endAt: occurrenceEnd,
        timezone: parent.timezone,
        allDay: parent.allDay,
        location: parent.location,
        showAs: parent.showAs,
        visibility: parent.visibility,
        visibilityUserIds: parent.visibilityUserIds,
        recurringParentId: parent.id,
        originalStartAt: occurrenceStart,
        isException: false,
        reminderMinutes: parent.reminderMinutes,
        source: parent.source,
        agentSuggested: parent.agentSuggested,
        metadata: mergeMetadata(eventMetadata(parent), {
          recurring_parent_id: parent.id,
          original_start_at: occurrenceStart.toISOString(),
        }),
      })
      .returning();
    if (!row) return null;

    const { scheduledRawEventId, startAtRawEventId } = await insertCalendarRawEvents(tx, {
      teamId,
      userId,
      calendarEventId: row.id,
      title: parent.title,
      description: parent.description,
      startAt: occurrenceStart,
      endAt: occurrenceEnd,
      timezone: parent.timezone,
      location: parent.location,
      visibility: parent.visibility,
      visibilityUserIds: parent.visibilityUserIds,
    });
    await tx
      .update(calendarEvents)
      .set({ scheduledRawEventId, startAtRawEventId })
      .where(eq(calendarEvents.id, row.id));
    return row.id;
  }

  async function materializeParent(
    tx: DbOrTx,
    parent: CalendarEventRow,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<string[]> {
    if (!parent.rrule || parent.recurringParentId || parent.deletedAt) return [];
    const window = recurrenceWindowFrom(parent.startAt);
    const from = opts.from ?? window.from;
    const to = opts.to ?? window.to;
    const starts = expandRRuleBetween({
      rrule: parent.rrule,
      startAt: parent.startAt,
      timezone: parent.timezone,
      from,
      to,
    });
    const ids: string[] = [];
    for (const start of starts) {
      const id = await insertOccurrence(tx, parent, start);
      if (id) ids.push(id);
    }
    return ids;
  }

  async function materializeParentById(
    tx: DbOrTx,
    id: string,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<string[]> {
    const rows = await tx
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.teamId, teamId)))
      .limit(1);
    const parent = rows[0] as CalendarEventRow | undefined;
    if (!parent) return [];
    return materializeParent(tx, parent, opts);
  }

  async function rematerializeParent(
    tx: DbOrTx,
    parent: CalendarEventRow,
    opts: { from?: Date; to?: Date } = {},
  ): Promise<string[]> {
    await tx
      .update(calendarEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          eq(calendarEvents.recurringParentId, parent.id),
          eq(calendarEvents.isException, false),
          isNull(calendarEvents.deletedAt),
        ),
      );
    return materializeParent(tx, parent, opts);
  }

  async function confirmProposalGroup(
    tx: DbOrTx,
    chosen: CalendarEventRow,
    patch: UpdateCalendarEventInput,
  ): Promise<string[]> {
    const metadata = eventMetadata(chosen);
    const groupId =
      typeof metadata.proposalGroupId === 'string'
        ? metadata.proposalGroupId
        : typeof metadata.proposal_group_id === 'string'
          ? metadata.proposal_group_id
          : null;
    const status =
      patch.metadata && typeof patch.metadata.proposalStatus === 'string'
        ? patch.metadata.proposalStatus
        : null;
    if (!groupId || status !== 'confirmed') return [];
    const siblings = await tx
      .select({
        id: calendarEvents.id,
        scheduledRawEventId: calendarEvents.scheduledRawEventId,
        startAtRawEventId: calendarEvents.startAtRawEventId,
      })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          sql`${calendarEvents.metadata} ->> 'proposalGroupId' = ${groupId}`,
          sql`${calendarEvents.id} <> ${chosen.id}`,
          isNull(calendarEvents.deletedAt),
        ),
      );
    if (siblings.length === 0) return [];
    const siblingIds = siblings.map((sibling) => sibling.id);
    await tx
      .update(calendarEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(inArray(calendarEvents.id, siblingIds));
    const linkedRawEventIds = siblings.flatMap((sibling) =>
      [sibling.scheduledRawEventId, sibling.startAtRawEventId].filter(
        (rid): rid is string => rid !== null && rid.length > 0,
      ),
    );
    if (linkedRawEventIds.length > 0) {
      const tombstone = JSON.stringify({ deleted: true });
      await tx
        .update(rawEvents)
        .set({
          sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${tombstone}::jsonb`,
        })
        .where(inArray(rawEvents.id, linkedRawEventIds));
    }
    return siblingIds;
  }

  return {
    async createCalendarEvent(
      input: CreateCalendarEventInput,
    ): Promise<CalendarEventWithRedaction> {
      await ensureMember();
      if (input.endAt <= input.startAt) {
        throw new Error('End time must be after start time');
      }
      const timezone = input.timezone ?? 'UTC';
      const rrule = input.rrule?.trim()
        ? validateRRule({ rrule: input.rrule, startAt: input.startAt, timezone })
        : null;

      const created = await db.transaction(async (tx) => {
        const vis = input.visibility ?? 'team';
        const visUserIds = await validateVisibilityUserIds(
          vis,
          input.visibilityUserIds ?? null,
          requireTeamMember,
        );
        const linkedEntityIds = input.linkedEntityIds
          ? await assertEntitiesBelongToTeam(tx, { teamId, entityIds: input.linkedEntityIds })
          : [];

        const [row] = await tx
          .insert(calendarEvents)
          .values({
            teamId,
            createdByUserId: userId,
            title: input.title,
            description: input.description ?? null,
            startAt: input.startAt,
            endAt: input.endAt,
            timezone,
            allDay: input.allDay ?? false,
            location: input.location ?? null,
            showAs: showAsOrDefault(input.showAs),
            visibility: vis,
            visibilityUserIds: visUserIds,
            recurringParentId: input.recurringParentId ?? null,
            originalStartAt: input.originalStartAt ?? null,
            isException: input.isException ?? false,
            rrule,
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
          description: input.description ?? null,
          startAt: input.startAt,
          endAt: input.endAt,
          timezone,
          location: input.location ?? null,
          visibility: vis,
          visibilityUserIds: visUserIds,
        });

        await tx
          .update(calendarEvents)
          .set({ scheduledRawEventId, startAtRawEventId })
          .where(eq(calendarEvents.id, row.id));

        if (linkedEntityIds.length > 0) {
          await tx.insert(calendarEventEntities).values(
            linkedEntityIds.map((entityId) => ({
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

        if (rrule && !input.recurringParentId) {
          await materializeParent(tx, updated);
        }

        return redactIfNeeded(updated);
      });

      if (created.visibility === 'team') {
        await enqueueCalendarEventEmbedding(teamId, created.id);
      }

      return created;
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
            calendarReadVisibility,
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
      const conditions = [eq(calendarEvents.teamId, teamId), calendarReadVisibility];

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
    ): Promise<CalendarEventUpdateResult | null> {
      await ensureMember();

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, id),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarWriteVisibility,
            ),
          )
          .limit(1);

        const row = existing[0];
        if (!row) return null;
        const current = row as CalendarEventRow;
        const recurrenceMode: RecurrenceEditMode =
          patch.recurrenceEditMode ?? (current.recurringParentId ? 'single' : 'series');

        if (recurrenceMode === 'this_and_future' && current.recurringParentId) {
          const [parent] = await tx
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.id, current.recurringParentId),
                eq(calendarEvents.teamId, teamId),
                isNull(calendarEvents.deletedAt),
              ),
            )
            .limit(1);
          const parentRow = parent as CalendarEventRow | undefined;
          if (!parentRow?.rrule) throw new Error('Recurring parent not found');
          const splitAt = current.originalStartAt ?? current.startAt;
          await tx
            .update(calendarEvents)
            .set({
              rrule: rruleUntil(parentRow.rrule, splitAt),
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, parentRow.id));
          await tx
            .update(calendarEvents)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                eq(calendarEvents.recurringParentId, parentRow.id),
                gte(calendarEvents.originalStartAt, splitAt),
                isNull(calendarEvents.deletedAt),
              ),
            );

          const newStart = patch.startAt ?? current.startAt;
          const newEnd = patch.endAt ?? current.endAt;
          if (newEnd <= newStart) throw new Error('End time must be after start time');
          const newTimezone = patch.timezone ?? current.timezone;
          const newRrule = patch.rrule?.trim()
            ? validateRRule({ rrule: patch.rrule, startAt: newStart, timezone: newTimezone })
            : rruleForSplit({
                rrule: parentRow.rrule,
                startAt: parentRow.startAt,
                timezone: parentRow.timezone,
                splitAt,
              });
          const [newParent] = await tx
            .insert(calendarEvents)
            .values({
              teamId,
              createdByUserId: current.createdByUserId,
              title: patch.title ?? current.title,
              description: patch.description ?? current.description,
              startAt: newStart,
              endAt: newEnd,
              timezone: newTimezone,
              allDay: patch.allDay ?? current.allDay,
              location: patch.location ?? current.location,
              showAs: patch.showAs ?? showAsOrDefault(current.showAs),
              visibility: patch.visibility ?? current.visibility,
              visibilityUserIds: patch.visibilityUserIds ?? current.visibilityUserIds,
              rrule: newRrule,
              reminderMinutes: patch.reminderMinutes ?? current.reminderMinutes,
              source: current.source,
              metadata: patch.metadata
                ? mergeMetadata(eventMetadata(current), patch.metadata)
                : eventMetadata(current),
            })
            .returning();
          if (!newParent) throw new Error('Failed to split recurring event');
          const { scheduledRawEventId, startAtRawEventId } = await insertCalendarRawEvents(tx, {
            teamId,
            userId,
            calendarEventId: newParent.id,
            title: newParent.title,
            description: newParent.description,
            startAt: newParent.startAt,
            endAt: newParent.endAt,
            timezone: newParent.timezone,
            location: newParent.location,
            visibility: newParent.visibility,
            visibilityUserIds: newParent.visibilityUserIds,
          });
          const [hydrated] = await tx
            .update(calendarEvents)
            .set({ scheduledRawEventId, startAtRawEventId })
            .where(eq(calendarEvents.id, newParent.id))
            .returning();
          if (!hydrated) throw new Error('Failed to hydrate split recurring event');
          await materializeParent(tx, hydrated as CalendarEventRow);
          return {
            event: redactIfNeeded(hydrated as CalendarEventRow),
            changedFields: [
              'startAt',
              'endAt',
              'rrule',
              'recurrenceEditMode',
            ] as (keyof UpdateCalendarEventInput)[],
            qdrantAction: hydrated.visibility === 'team' ? ('embed' as const) : null,
          };
        }

        const changedFields = new Set<keyof UpdateCalendarEventInput>();
        if (patch.title !== undefined && patch.title !== row.title) changedFields.add('title');
        if (patch.description !== undefined && patch.description !== row.description) {
          changedFields.add('description');
        }
        if (patch.startAt !== undefined && !sameDate(patch.startAt, row.startAt)) {
          changedFields.add('startAt');
        }
        if (patch.endAt !== undefined && !sameDate(patch.endAt, row.endAt)) {
          changedFields.add('endAt');
        }
        if (patch.timezone !== undefined && patch.timezone !== row.timezone) {
          changedFields.add('timezone');
        }
        if (patch.allDay !== undefined && patch.allDay !== row.allDay) {
          changedFields.add('allDay');
        }
        if (patch.location !== undefined && patch.location !== row.location) {
          changedFields.add('location');
        }
        if (patch.showAs !== undefined && patch.showAs !== row.showAs) {
          changedFields.add('showAs');
        }
        if (patch.visibility !== undefined && patch.visibility !== row.visibility) {
          changedFields.add('visibility');
        }
        if (patch.rrule !== undefined) {
          const nextRrule = patch.rrule?.trim()
            ? validateRRule({
                rrule: patch.rrule,
                startAt: patch.startAt ?? row.startAt,
                timezone: patch.timezone ?? row.timezone,
              })
            : null;
          if (nextRrule !== row.rrule) changedFields.add('rrule');
          patch.rrule = nextRrule;
        }
        if (
          patch.visibilityUserIds !== undefined &&
          !sameStringArray(patch.visibilityUserIds, row.visibilityUserIds)
        ) {
          changedFields.add('visibilityUserIds');
        }
        if (patch.reminderMinutes !== undefined && patch.reminderMinutes !== row.reminderMinutes) {
          changedFields.add('reminderMinutes');
        }
        if (
          patch.metadata !== undefined &&
          !sameJson(patch.metadata, row.metadata as Record<string, unknown>)
        ) {
          changedFields.add('metadata');
        }

        if (changedFields.size === 0) {
          return {
            event: redactIfNeeded(row as CalendarEventRow),
            changedFields: [],
            qdrantAction: null,
          };
        }

        const effectiveStart = patch.startAt ?? row.startAt;
        const effectiveEnd = patch.endAt ?? row.endAt;
        if (effectiveEnd <= effectiveStart) {
          throw new Error('End time must be after start time');
        }

        const hasVisibilityChange =
          changedFields.has('visibility') || changedFields.has('visibilityUserIds');
        if (hasVisibilityChange && row.createdByUserId !== userId) {
          throw new Error('Only the visibility owner can change this event');
        }

        const newVis = patch.visibility ?? row.visibility;
        const newVisUserIds = hasVisibilityChange
          ? await validateVisibilityUserIds(
              newVis,
              patch.visibilityUserIds ?? row.visibilityUserIds,
              requireTeamMember,
            )
          : row.visibilityUserIds;

        const setClause: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.title !== undefined) setClause.title = patch.title;
        if (patch.description !== undefined) setClause.description = patch.description;
        if (patch.startAt !== undefined) setClause.startAt = patch.startAt;
        if (patch.endAt !== undefined) setClause.endAt = patch.endAt;
        if (patch.timezone !== undefined) setClause.timezone = patch.timezone;
        if (patch.allDay !== undefined) setClause.allDay = patch.allDay;
        if (patch.location !== undefined) setClause.location = patch.location;
        if (patch.showAs !== undefined) setClause.showAs = patch.showAs;
        if (patch.visibility !== undefined) setClause.visibility = patch.visibility;
        if (patch.rrule !== undefined) setClause.rrule = patch.rrule;
        if (recurrenceMode === 'single' && row.recurringParentId) setClause.isException = true;
        if (hasVisibilityChange) {
          setClause.visibilityUserIds = newVisUserIds;
        }
        if (patch.reminderMinutes !== undefined) setClause.reminderMinutes = patch.reminderMinutes;
        if (patch.metadata !== undefined) {
          setClause.metadata = mergeMetadata(
            eventMetadata(row as CalendarEventRow),
            patch.metadata,
          );
        }

        const [updated] = await tx
          .update(calendarEvents)
          .set(setClause)
          .where(eq(calendarEvents.id, id))
          .returning();

        if (!updated) return null;

        const newTitle = patch.title ?? row.title;
        const timelineFields: (keyof UpdateCalendarEventInput)[] = [
          'title',
          'description',
          'startAt',
          'endAt',
          'timezone',
          'allDay',
          'location',
          'visibility',
          'visibilityUserIds',
          'showAs',
          'rrule',
        ];
        const hasTimelineChange = timelineFields.some((field) => changedFields.has(field));
        const hasEmbeddingChange = [
          'title',
          'description',
          'startAt',
          'endAt',
          'timezone',
          'location',
          'visibility',
          'visibilityUserIds',
          'showAs',
          'rrule',
        ].some((field) => changedFields.has(field as keyof UpdateCalendarEventInput));

        // Sync linked raw_events: title, time, AND visibility must stay
        // in lockstep with the calendar event. Without the visibility
        // update, the timeline's visibilityFilter keeps serving full
        // content to teammates after the event goes private.
        const linkedRawEventIds = [row.startAtRawEventId, row.scheduledRawEventId].filter(
          (rid): rid is string => rid !== null && rid.length > 0,
        );
        if (hasVisibilityChange && linkedRawEventIds.length > 0) {
          const rawPatch: Record<string, unknown> = {
            visibility: newVis,
            visibilityUserIds: newVisUserIds,
          };
          for (const rid of linkedRawEventIds) {
            await tx.update(rawEvents).set(rawPatch).where(eq(rawEvents.id, rid));
          }
        }

        const hasOccurrenceContentChange = [
          'title',
          'description',
          'startAt',
          'endAt',
          'timezone',
          'location',
        ].some((field) => changedFields.has(field as keyof UpdateCalendarEventInput));

        if (hasOccurrenceContentChange && row.startAtRawEventId) {
          const startRawPatch: Record<string, unknown> = {
            contentText: buildCalendarTimelineText({
              title: newTitle,
              description: patch.description ?? row.description,
              startAt: effectiveStart,
              endAt: effectiveEnd,
              timezone: patch.timezone ?? row.timezone,
              location: patch.location ?? row.location,
            }),
          };
          if (patch.startAt) startRawPatch.occurredAt = patch.startAt;
          await tx
            .update(rawEvents)
            .set(startRawPatch)
            .where(eq(rawEvents.id, row.startAtRawEventId));
        }

        if (patch.title && row.scheduledRawEventId) {
          await tx
            .update(rawEvents)
            .set({ contentText: `Scheduled: ${patch.title}` })
            .where(eq(rawEvents.id, row.scheduledRawEventId));
        }

        if (hasTimelineChange) {
          await tx.insert(rawEvents).values({
            teamId,
            authorUserId: userId,
            source: 'calendar',
            contentText: `Updated: ${newTitle}`,
            occurredAt: new Date(),
            visibility: newVis,
            visibilityUserIds: newVisUserIds,
            visibilityOwnerUserId: row.createdByUserId,
            sourceMetadata: {
              calendar_event_id: id,
              action: 'updated',
            },
          });
        }

        const cancelledProposalEventIds = await confirmProposalGroup(
          tx,
          updated as CalendarEventRow,
          patch,
        );

        let qdrantAction: CalendarQdrantAction = null;
        // If the event is still team-visible, re-embed with updated content.
        // If it went non-team, delete the old Qdrant point so stale content
        // doesn't surface in semantic search.
        if (hasEmbeddingChange) {
          qdrantAction = newVis === 'team' ? 'embed' : 'delete';
        }

        return {
          event: redactIfNeeded(updated as CalendarEventRow),
          changedFields: [...changedFields],
          qdrantAction,
          cancelledProposalEventIds,
          rematerialize:
            recurrenceMode === 'series' &&
            !row.recurringParentId &&
            (changedFields.has('title') ||
              changedFields.has('description') ||
              changedFields.has('startAt') ||
              changedFields.has('endAt') ||
              changedFields.has('timezone') ||
              changedFields.has('allDay') ||
              changedFields.has('location') ||
              changedFields.has('visibility') ||
              changedFields.has('visibilityUserIds') ||
              changedFields.has('showAs') ||
              changedFields.has('rrule')),
        };
      });

      if (!result) return null;
      if (result.qdrantAction === 'embed') {
        await enqueueCalendarEventEmbedding(teamId, id);
      } else if (result.qdrantAction === 'delete') {
        await deleteCalendarEventPoints(teamId, id);
      }
      if ('rematerialize' in result && result.rematerialize) {
        await db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(calendarEvents)
            .where(eq(calendarEvents.id, result.event.id))
            .limit(1);
          const parent = rows[0] as CalendarEventRow | undefined;
          if (parent) await rematerializeParent(tx, parent);
        });
      }
      const cancelledProposalEventIds =
        'cancelledProposalEventIds' in result ? (result.cancelledProposalEventIds ?? []) : [];
      if (cancelledProposalEventIds.length > 0) {
        await Promise.all(
          cancelledProposalEventIds.map((eventId) => deleteCalendarEventPoints(teamId, eventId)),
        );
      }

      return { ...result.event, changedFields: result.changedFields };
    },

    async deleteCalendarEvent(
      id: string,
      opts: { recurrenceEditMode?: RecurrenceEditMode } = {},
    ): Promise<boolean> {
      await ensureMember();

      const deleted = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, id),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarWriteVisibility,
            ),
          )
          .limit(1);

        const row = existing[0];
        if (!row) return false;
        const current = row as CalendarEventRow;
        const recurrenceMode =
          opts.recurrenceEditMode ?? (current.recurringParentId ? 'single' : 'series');

        await tx
          .update(calendarEvents)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
            ...(current.recurringParentId && recurrenceMode === 'single'
              ? { isException: true }
              : {}),
          })
          .where(eq(calendarEvents.id, id));

        if (!current.recurringParentId && recurrenceMode === 'series') {
          await tx
            .update(calendarEvents)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                eq(calendarEvents.recurringParentId, id),
                isNull(calendarEvents.deletedAt),
              ),
            );
        }

        const linkedRawEventIds = [row.startAtRawEventId, row.scheduledRawEventId].filter(
          (rid): rid is string => rid !== null && rid.length > 0,
        );
        if (linkedRawEventIds.length > 0) {
          const tombstone = JSON.stringify({ deleted: true });
          await tx
            .update(rawEvents)
            .set({
              sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${tombstone}::jsonb`,
            })
            .where(inArray(rawEvents.id, linkedRawEventIds));
        }

        await tx.insert(rawEvents).values({
          teamId,
          authorUserId: userId,
          source: 'calendar',
          contentText: `Cancelled: ${row.title}`,
          occurredAt: new Date(),
          visibility: row.visibility,
          visibilityUserIds: row.visibilityUserIds,
          visibilityOwnerUserId: row.createdByUserId,
          sourceMetadata: {
            calendar_event_id: id,
            action: 'cancelled',
          },
        });

        return true;
      });

      if (deleted) {
        await deleteCalendarEventPoints(teamId, id);
      }

      return deleted;
    },

    async linkEntity(
      calendarEventId: string,
      entityId: string,
      relationshipType = 'related',
    ): Promise<void> {
      await ensureMember();
      await db.transaction(async (tx) => {
        const [eventRow] = await tx
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, calendarEventId),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarWriteVisibility,
            ),
          )
          .limit(1);
        if (!eventRow) throw new Error('Calendar event not found');

        await assertEntitiesBelongToTeam(tx, { teamId, entityIds: [entityId] });

        await tx
          .insert(calendarEventEntities)
          .values({ calendarEventId, entityId, teamId, relationshipType })
          .onConflictDoNothing();
      });
    },

    async unlinkEntity(calendarEventId: string, entityId: string): Promise<void> {
      await ensureMember();
      await db.transaction(async (tx) => {
        const [eventRow] = await tx
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.id, calendarEventId),
              eq(calendarEvents.teamId, teamId),
              isNull(calendarEvents.deletedAt),
              calendarWriteVisibility,
            ),
          )
          .limit(1);
        if (!eventRow) throw new Error('Calendar event not found');

        await tx
          .delete(calendarEventEntities)
          .where(
            and(
              eq(calendarEventEntities.calendarEventId, calendarEventId),
              eq(calendarEventEntities.entityId, entityId),
              eq(calendarEventEntities.teamId, teamId),
            ),
          );
      });
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

    async materializeRecurringEvent(
      id: string,
      opts: Omit<MaterializeRecurringEventsInput, 'parentId'> = {},
    ): Promise<string[]> {
      await ensureMember();
      return db.transaction((tx) => materializeParentById(tx, id, opts));
    },

    async materializeRecurringEvents(opts: MaterializeRecurringEventsInput = {}): Promise<number> {
      await ensureMember();
      const conditions = [
        eq(calendarEvents.teamId, teamId),
        isNull(calendarEvents.deletedAt),
        isNull(calendarEvents.recurringParentId),
        sql`${calendarEvents.rrule} IS NOT NULL`,
      ];
      if (opts.parentId) conditions.push(eq(calendarEvents.id, opts.parentId));
      const parents = await db
        .select()
        .from(calendarEvents)
        .where(and(...conditions))
        .orderBy(asc(calendarEvents.startAt))
        .limit(500);
      let count = 0;
      await db.transaction(async (tx) => {
        for (const parent of parents) {
          const ids = await materializeParent(tx, parent as CalendarEventRow, opts);
          count += ids.length;
        }
      });
      return count;
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
        defaultTimezone: 'UTC',
        updatedAt: new Date(),
      };
    },

    async upsertCalendarSettings(patch: {
      defaultReminderMinutes?: number;
      defaultVisibility?: Visibility;
      defaultTimezone?: string;
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
      if (patch.defaultTimezone !== undefined) {
        insertValues.defaultTimezone = patch.defaultTimezone;
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
