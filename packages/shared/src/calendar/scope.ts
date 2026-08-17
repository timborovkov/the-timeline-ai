import {
  calendarEventEntities,
  calendarEvents,
  type Db,
  entities,
  rawEvents,
  teamCalendarSettings,
} from '@timeline/db';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  calendarEventMutationLockKey,
  calendarEventMutationTargetId,
  type CalendarRecurrenceEditMode,
} from '#src/calendar/locking.js';
import {
  buildCalendarSourcePayloadMetadata,
  buildCalendarTimelineText,
  insertCalendarRawEvents,
  normalizeCalendarRawEventIds,
  tombstoneCalendarRawEventIds,
} from '#src/calendar/raw-events.js';
import {
  expandRRuleBetween,
  recurrenceWindowFrom,
  rruleForSplit,
  rruleUntil,
  validateRRule,
} from '#src/calendar/recurrence.js';
import { sourceMetadataWithConversationArtifacts } from '#src/conversational/contact-artifacts.js';
import { displayObjectTitle } from '#src/objects/types.js';
import {
  refreshLinkArtifactsForRawEvent,
  reconcileLinkArtifactsForRawEvent,
} from '#src/conversational/link-artifacts.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { childLogger } from '#src/logger.js';
import { getQdrantClient } from '#src/qdrant/client.js';
import { buildPointId } from '#src/qdrant/point-id.js';
import { enqueueCalendarEventEmbedJob } from '#src/queue/queues.js';
import { assertValidTimezone } from '#src/time/index.js';
import { validateVisibilityUserIds } from '#src/visibility.js';

type Visibility = 'private' | 'team' | 'specific_users';
type CalendarShowAs = 'busy' | 'free' | 'tentative';
type CalendarEventSource = 'internal' | 'google' | 'caldav';
type RecurrenceEditMode = CalendarRecurrenceEditMode;
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type CalendarQdrantAction = 'embed' | 'delete' | null;

export interface CalendarLinkedObjectRow {
  calendarEventId: string;
  id: string;
  title: string;
  type: string;
  relationshipType: string;
}

const log = childLogger('calendar:scope');
const RECURRING_PARENT_PAGE_SIZE = 500;

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function sourceMetadataReplacingLinks(
  metadata: unknown,
  text: string | null | undefined,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = { ...recordFromUnknown(metadata), ...patch };
  delete base.links;
  delete base.contacts;
  return sourceMetadataWithConversationArtifacts(base, text);
}

async function updateCalendarRawEventContent(
  tx: DbOrTx,
  args: {
    teamId: string;
    rawEventId: string;
    contentText: string;
    occurredAt?: Date;
    sourceMetadataPatch?: Record<string, unknown>;
  },
): Promise<void> {
  const [existing] = await tx
    .select({ sourceMetadata: rawEvents.sourceMetadata })
    .from(rawEvents)
    .where(and(eq(rawEvents.id, args.rawEventId), eq(rawEvents.teamId, args.teamId)))
    .limit(1);
  if (!existing) return;
  await tx
    .update(rawEvents)
    .set({
      contentText: args.contentText,
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
      sourceMetadata: sourceMetadataReplacingLinks(
        existing.sourceMetadata,
        args.contentText,
        args.sourceMetadataPatch,
      ),
    })
    .where(eq(rawEvents.id, args.rawEventId));
  await refreshLinkArtifactsForRawEvent(tx, {
    teamId: args.teamId,
    rawEventId: args.rawEventId,
    text: args.contentText,
    occurredAt: args.occurredAt ?? null,
  });
}

export interface CalendarScopeDeps {
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: 'member' | 'admin' | 'owner') => Promise<unknown>;
  requireTeamMember: (otherUserId: string) => Promise<void>;
  postCommitEffects?: (() => void | Promise<void>)[];
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

export interface ListCalendarEventPageInput extends ListCalendarEventsInput {
  offset?: number;
  order?: 'asc' | 'desc';
  search?: string;
  startFrom?: Date;
  startTo?: Date;
}

export interface CalendarEventPage {
  events: CalendarEventWithRedaction[];
  total: number;
}

export interface MaterializeRecurringEventsInput {
  from?: Date;
  to?: Date;
  parentId?: string;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

function withTimeFrom(baseDate: Date, timeSource: Date): Date {
  const next = new Date(baseDate);
  next.setUTCHours(
    timeSource.getUTCHours(),
    timeSource.getUTCMinutes(),
    timeSource.getUTCSeconds(),
    timeSource.getUTCMilliseconds(),
  );
  return next;
}

function patchForSeriesParent(
  patch: UpdateCalendarEventInput,
  parent: CalendarEventRow,
): UpdateCalendarEventInput {
  const next: UpdateCalendarEventInput = { ...patch, recurrenceEditMode: 'series' };
  if (patch.startAt) {
    const startAt = withTimeFrom(parent.startAt, patch.startAt);
    next.startAt = startAt;
    if (patch.endAt) {
      next.endAt = new Date(startAt.getTime() + (patch.endAt.getTime() - patch.startAt.getTime()));
    }
  } else if (patch.endAt) {
    next.endAt = withTimeFrom(parent.endAt, patch.endAt);
  }
  return next;
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

function calendarPayloadInputFromRow(
  row: CalendarEventRow,
): Parameters<typeof buildCalendarSourcePayloadMetadata>[0] {
  return {
    calendarEventId: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    location: row.location,
  };
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

async function enqueueCalendarEventEmbeddings(teamId: string, eventIds: string[]): Promise<void> {
  await Promise.all(
    uniqueIds(eventIds).map((eventId) => enqueueCalendarEventEmbedding(teamId, eventId)),
  );
}

async function deleteCalendarEventPointsForIds(teamId: string, eventIds: string[]): Promise<void> {
  await Promise.all(
    uniqueIds(eventIds).map((eventId) => deleteCalendarEventPoints(teamId, eventId)),
  );
}

async function tombstoneLinkedRawEventsForCalendarEventIds(
  tx: DbOrTx,
  args: { teamId: string; eventIds: string[] },
): Promise<void> {
  const ids = uniqueIds(args.eventIds);
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      scheduledRawEventId: calendarEvents.scheduledRawEventId,
      startAtRawEventId: calendarEvents.startAtRawEventId,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.teamId, args.teamId), inArray(calendarEvents.id, ids)));
  await tombstoneCalendarRawEventIds(
    tx,
    rows.flatMap((row) =>
      [row.scheduledRawEventId, row.startAtRawEventId].filter(
        (rawEventId): rawEventId is string => rawEventId !== null && rawEventId.length > 0,
      ),
    ),
  );
}

export function createCalendarScope(deps: CalendarScopeDeps) {
  const { db, teamId, userId, ensureMember, requireTeamMember } = deps;

  async function runOrDeferPostCommit(effect: () => void | Promise<void>): Promise<void> {
    if (deps.postCommitEffects) deps.postCommitEffects.push(effect);
    else await effect();
  }

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

  async function lockCalendarEventMutation(
    tx: DbTx,
    eventId: string,
    recurrenceEditMode?: RecurrenceEditMode,
  ): Promise<boolean> {
    const [target] = await tx
      .select({ recurringParentId: calendarEvents.recurringParentId })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.teamId, teamId),
          isNull(calendarEvents.deletedAt),
          calendarWriteVisibility,
        ),
      )
      .limit(1);
    if (!target) return false;
    const mutationTargetId = calendarEventMutationTargetId(
      eventId,
      target.recurringParentId,
      recurrenceEditMode,
    );
    const mutationLockKey = calendarEventMutationLockKey(teamId, mutationTargetId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${mutationLockKey}, 0))`);
    return true;
  }

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
  ): Promise<{ id: string; inserted: boolean } | null> {
    if (sameDate(occurrenceStart, parent.startAt)) return { id: parent.id, inserted: false };
    const durationMs = parent.endAt.getTime() - parent.startAt.getTime();
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
    const existingRows = await tx
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
      );
    const activeExisting = existingRows.find((existing) => !existing.deletedAt);
    if (activeExisting) return { id: activeExisting.id, inserted: false };
    const exception = existingRows.find((existing) => existing.isException);
    if (exception) {
      return { id: exception.id, inserted: false };
    }

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
      userId: parent.createdByUserId ?? userId,
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
    return { id: row.id, inserted: true };
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
      const occurrence = await insertOccurrence(tx, parent, start);
      if (occurrence?.inserted) ids.push(occurrence.id);
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
  ): Promise<{ materializedIds: string[]; deletedIds: string[] }> {
    const children = await tx
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          eq(calendarEvents.recurringParentId, parent.id),
          isNull(calendarEvents.deletedAt),
        ),
      );
    const deletedIds = children.map((child) => child.id);
    await tombstoneLinkedRawEventsForCalendarEventIds(tx, { teamId, eventIds: deletedIds });
    await tx
      .update(calendarEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date(), isException: false })
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          eq(calendarEvents.recurringParentId, parent.id),
          isNull(calendarEvents.deletedAt),
        ),
      );
    const materializedIds = await materializeParent(tx, parent, opts);
    return { materializedIds, deletedIds };
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
    await tombstoneCalendarRawEventIds(
      tx,
      siblings.flatMap((sibling) =>
        [sibling.scheduledRawEventId, sibling.startAtRawEventId].filter(
          (rid): rid is string => rid !== null && rid.length > 0,
        ),
      ),
    );
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

      const { created, materializedIds } = await db.transaction(async (tx) => {
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

        const materializedIds =
          rrule && !input.recurringParentId ? await materializeParent(tx, updated) : [];

        return { created: redactIfNeeded(updated), materializedIds };
      });

      if (created.visibility === 'team') {
        await runOrDeferPostCommit(() =>
          enqueueCalendarEventEmbeddings(teamId, [created.id, ...materializedIds]),
        );
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

    async listCalendarEventPage(opts: ListCalendarEventPageInput = {}): Promise<CalendarEventPage> {
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
      if (opts.startFrom) {
        conditions.push(gte(calendarEvents.startAt, opts.startFrom));
      }
      if (opts.startTo) {
        conditions.push(lt(calendarEvents.startAt, opts.startTo));
      }
      const search = opts.search?.trim();
      if (search) {
        const needle = `%${escapeSqlLike(search.toLowerCase())}%`;
        conditions.push(sql`lower(
          CASE
            WHEN ${calendarEvents.visibility} = 'private'
              AND ${calendarEvents.createdByUserId} IS DISTINCT FROM ${userId}::uuid
            THEN 'busy'
            ELSE concat_ws(' ', ${calendarEvents.title}, ${calendarEvents.description}, ${calendarEvents.location})
          END
        ) LIKE ${needle} ESCAPE '\\'`);
      }

      const where = and(...conditions);
      const totalRows = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .where(where);
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(where)
        .orderBy(opts.order === 'desc' ? desc(calendarEvents.startAt) : asc(calendarEvents.startAt))
        .limit(opts.limit ?? 50)
        .offset(opts.offset ?? 0);

      return {
        events: (rows as CalendarEventRow[]).map(redactIfNeeded),
        total: totalRows[0]?.total ?? 0,
      };
    },

    async updateCalendarEvent(
      id: string,
      patch: UpdateCalendarEventInput,
    ): Promise<CalendarEventUpdateResult | null> {
      await ensureMember();

      const result = await db.transaction(async (tx) => {
        if (!(await lockCalendarEventMutation(tx, id, patch.recurrenceEditMode))) return null;
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

        let row = existing[0];
        if (!row) return null;
        let current = row as CalendarEventRow;
        let targetId = id;
        let effectivePatch = patch;
        const requestedRecurrenceMode: RecurrenceEditMode =
          patch.recurrenceEditMode ?? (current.recurringParentId ? 'single' : 'series');
        const recurrenceMode: RecurrenceEditMode = !current.recurringParentId
          ? 'series'
          : requestedRecurrenceMode;

        if (recurrenceMode === 'this_and_future' && current.recurringParentId) {
          const [parent] = await tx
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.id, current.recurringParentId),
                eq(calendarEvents.teamId, teamId),
                isNull(calendarEvents.deletedAt),
                calendarWriteVisibility,
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
          const futureChildren = await tx
            .select({ id: calendarEvents.id })
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                eq(calendarEvents.recurringParentId, parentRow.id),
                gte(calendarEvents.originalStartAt, splitAt),
                isNull(calendarEvents.deletedAt),
              ),
            );
          const deletedOccurrenceIds = futureChildren.map((child) => child.id);
          await tombstoneLinkedRawEventsForCalendarEventIds(tx, {
            teamId,
            eventIds: deletedOccurrenceIds,
          });
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
          const materializedIds = await materializeParent(tx, hydrated as CalendarEventRow);
          return {
            event: redactIfNeeded(hydrated as CalendarEventRow),
            changedFields: [
              'startAt',
              'endAt',
              'rrule',
              'recurrenceEditMode',
            ] as (keyof UpdateCalendarEventInput)[],
            qdrantAction: hydrated.visibility === 'team' ? ('embed' as const) : null,
            deletedOccurrenceIds,
            materializedIds,
          };
        }

        if (recurrenceMode === 'series' && current.recurringParentId) {
          const [parent] = await tx
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.id, current.recurringParentId),
                eq(calendarEvents.teamId, teamId),
                isNull(calendarEvents.deletedAt),
                calendarWriteVisibility,
              ),
            )
            .limit(1);
          if (!parent) throw new Error('Recurring parent not found');
          row = parent;
          current = parent as CalendarEventRow;
          targetId = current.id;
          effectivePatch = patchForSeriesParent(patch, current);
        }

        const changedFields = new Set<keyof UpdateCalendarEventInput>();
        if (effectivePatch.title !== undefined && effectivePatch.title !== row.title) {
          changedFields.add('title');
        }
        if (
          effectivePatch.description !== undefined &&
          effectivePatch.description !== row.description
        ) {
          changedFields.add('description');
        }
        if (
          effectivePatch.startAt !== undefined &&
          !sameDate(effectivePatch.startAt, row.startAt)
        ) {
          changedFields.add('startAt');
        }
        if (effectivePatch.endAt !== undefined && !sameDate(effectivePatch.endAt, row.endAt)) {
          changedFields.add('endAt');
        }
        if (effectivePatch.timezone !== undefined && effectivePatch.timezone !== row.timezone) {
          changedFields.add('timezone');
        }
        if (effectivePatch.allDay !== undefined && effectivePatch.allDay !== row.allDay) {
          changedFields.add('allDay');
        }
        if (effectivePatch.location !== undefined && effectivePatch.location !== row.location) {
          changedFields.add('location');
        }
        if (effectivePatch.showAs !== undefined && effectivePatch.showAs !== row.showAs) {
          changedFields.add('showAs');
        }
        if (
          effectivePatch.visibility !== undefined &&
          effectivePatch.visibility !== row.visibility
        ) {
          changedFields.add('visibility');
        }
        if (effectivePatch.rrule !== undefined) {
          const nextRrule = effectivePatch.rrule?.trim()
            ? validateRRule({
                rrule: effectivePatch.rrule,
                startAt: effectivePatch.startAt ?? row.startAt,
                timezone: effectivePatch.timezone ?? row.timezone,
              })
            : null;
          if (nextRrule !== row.rrule) changedFields.add('rrule');
          effectivePatch.rrule = nextRrule;
        }
        if (
          effectivePatch.visibilityUserIds !== undefined &&
          !sameStringArray(effectivePatch.visibilityUserIds, row.visibilityUserIds)
        ) {
          changedFields.add('visibilityUserIds');
        }
        if (
          effectivePatch.reminderMinutes !== undefined &&
          effectivePatch.reminderMinutes !== row.reminderMinutes
        ) {
          changedFields.add('reminderMinutes');
        }
        if (
          effectivePatch.metadata !== undefined &&
          !sameJson(effectivePatch.metadata, row.metadata as Record<string, unknown>)
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

        const effectiveStart = effectivePatch.startAt ?? row.startAt;
        const effectiveEnd = effectivePatch.endAt ?? row.endAt;
        if (effectiveEnd <= effectiveStart) {
          throw new Error('End time must be after start time');
        }

        const hasVisibilityChange =
          changedFields.has('visibility') || changedFields.has('visibilityUserIds');
        if (hasVisibilityChange && row.createdByUserId !== userId) {
          throw new Error('Only the visibility owner can change this event');
        }

        const newVis = effectivePatch.visibility ?? row.visibility;
        const newVisUserIds = hasVisibilityChange
          ? await validateVisibilityUserIds(
              newVis,
              effectivePatch.visibilityUserIds ?? row.visibilityUserIds,
              requireTeamMember,
            )
          : row.visibilityUserIds;

        const setClause: Record<string, unknown> = { updatedAt: new Date() };
        if (effectivePatch.title !== undefined) setClause.title = effectivePatch.title;
        if (effectivePatch.description !== undefined) {
          setClause.description = effectivePatch.description;
        }
        if (effectivePatch.startAt !== undefined) setClause.startAt = effectivePatch.startAt;
        if (effectivePatch.endAt !== undefined) setClause.endAt = effectivePatch.endAt;
        if (effectivePatch.timezone !== undefined) setClause.timezone = effectivePatch.timezone;
        if (effectivePatch.allDay !== undefined) setClause.allDay = effectivePatch.allDay;
        if (effectivePatch.location !== undefined) setClause.location = effectivePatch.location;
        if (effectivePatch.showAs !== undefined) setClause.showAs = effectivePatch.showAs;
        if (effectivePatch.visibility !== undefined)
          setClause.visibility = effectivePatch.visibility;
        if (effectivePatch.rrule !== undefined) setClause.rrule = effectivePatch.rrule;
        if (recurrenceMode === 'single' && row.recurringParentId) setClause.isException = true;
        if (hasVisibilityChange) {
          setClause.visibilityUserIds = newVisUserIds;
        }
        if (effectivePatch.reminderMinutes !== undefined) {
          setClause.reminderMinutes = effectivePatch.reminderMinutes;
        }
        if (effectivePatch.metadata !== undefined) {
          setClause.metadata = mergeMetadata(
            eventMetadata(row as CalendarEventRow),
            effectivePatch.metadata,
          );
        }

        const [updated] = await tx
          .update(calendarEvents)
          .set(setClause)
          .where(eq(calendarEvents.id, targetId))
          .returning();

        if (!updated) return null;

        const newTitle = effectivePatch.title ?? row.title;
        const calendarPayloadInput = {
          calendarEventId: targetId,
          title: newTitle,
          description: effectivePatch.description ?? row.description,
          startAt: effectiveStart,
          endAt: effectiveEnd,
          timezone: effectivePatch.timezone ?? row.timezone,
          location: effectivePatch.location ?? row.location,
        };
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
        const changedRawEventIds = new Set<string>();
        if (hasVisibilityChange && linkedRawEventIds.length > 0) {
          const rawPatch: Record<string, unknown> = {
            visibility: newVis,
            visibilityUserIds: newVisUserIds,
          };
          for (const rid of linkedRawEventIds) {
            await tx.update(rawEvents).set(rawPatch).where(eq(rawEvents.id, rid));
            changedRawEventIds.add(rid);
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
          await updateCalendarRawEventContent(tx, {
            teamId,
            rawEventId: row.startAtRawEventId,
            contentText: buildCalendarTimelineText({
              title: calendarPayloadInput.title,
              description: calendarPayloadInput.description,
              startAt: calendarPayloadInput.startAt,
              endAt: calendarPayloadInput.endAt,
              timezone: calendarPayloadInput.timezone,
              location: calendarPayloadInput.location,
            }),
            ...(effectivePatch.startAt ? { occurredAt: effectivePatch.startAt } : {}),
            sourceMetadataPatch: buildCalendarSourcePayloadMetadata(calendarPayloadInput, 'event'),
          });
          changedRawEventIds.add(row.startAtRawEventId);
        }

        if (hasOccurrenceContentChange && row.scheduledRawEventId) {
          await updateCalendarRawEventContent(tx, {
            teamId,
            rawEventId: row.scheduledRawEventId,
            contentText: `Scheduled: ${newTitle}`,
            sourceMetadataPatch: buildCalendarSourcePayloadMetadata(
              calendarPayloadInput,
              'scheduled',
            ),
          });
          changedRawEventIds.add(row.scheduledRawEventId);
        }

        if (hasTimelineChange) {
          const updateText = `Updated: ${newTitle}`;
          const [updatedRawEvent] = await tx
            .insert(rawEvents)
            .values({
              teamId,
              authorUserId: userId,
              source: 'calendar',
              contentText: updateText,
              occurredAt: new Date(),
              visibility: newVis,
              visibilityUserIds: newVisUserIds,
              visibilityOwnerUserId: row.createdByUserId,
              sourceMetadata: sourceMetadataWithConversationArtifacts(
                {
                  calendar_event_id: targetId,
                  action: 'updated',
                  ...buildCalendarSourcePayloadMetadata(calendarPayloadInput, 'updated'),
                },
                updateText,
              ),
            })
            .returning({ id: rawEvents.id });
          if (updatedRawEvent?.id) {
            changedRawEventIds.add(updatedRawEvent.id);
            await reconcileLinkArtifactsForRawEvent(tx, {
              teamId,
              rawEventId: updatedRawEvent.id,
              text: updateText,
            });
          }
        }

        await normalizeCalendarRawEventIds(tx, {
          teamId,
          rawEventIds: [...changedRawEventIds],
        });

        const cancelledProposalEventIds = await confirmProposalGroup(
          tx,
          updated as CalendarEventRow,
          effectivePatch,
        );

        let qdrantAction: CalendarQdrantAction = null;
        // If the event is still team-visible, re-embed with updated content.
        // If it went non-team, delete the old Qdrant point so stale content
        // doesn't surface in semantic search.
        if (hasEmbeddingChange) {
          qdrantAction = newVis === 'team' ? 'embed' : 'delete';
        }

        const rematerialized =
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
            changedFields.has('rrule'))
            ? await rematerializeParent(tx, updated as CalendarEventRow)
            : null;

        return {
          event: redactIfNeeded(updated as CalendarEventRow),
          changedFields: [...changedFields],
          qdrantAction,
          cancelledProposalEventIds,
          rematerialized,
        };
      });

      if (!result) return null;
      const materializedIds = 'materializedIds' in result ? (result.materializedIds ?? []) : [];
      const deletedOccurrenceIds =
        'deletedOccurrenceIds' in result ? (result.deletedOccurrenceIds ?? []) : [];
      const rematerialized = 'rematerialized' in result ? (result.rematerialized ?? null) : null;
      const cancelledProposalEventIds =
        'cancelledProposalEventIds' in result ? (result.cancelledProposalEventIds ?? []) : [];
      await runOrDeferPostCommit(async () => {
        if (result.qdrantAction === 'embed') {
          await enqueueCalendarEventEmbeddings(teamId, [result.event.id, ...materializedIds]);
        } else if (result.qdrantAction === 'delete') {
          await deleteCalendarEventPointsForIds(teamId, [result.event.id, ...materializedIds]);
        }
        if (deletedOccurrenceIds.length > 0) {
          await deleteCalendarEventPointsForIds(teamId, deletedOccurrenceIds);
        }
        if (rematerialized) {
          await deleteCalendarEventPointsForIds(teamId, rematerialized.deletedIds);
          if (result.event.visibility === 'team') {
            await enqueueCalendarEventEmbeddings(teamId, rematerialized.materializedIds);
          }
        }
        if (cancelledProposalEventIds.length > 0) {
          await Promise.all(
            cancelledProposalEventIds.map((eventId) => deleteCalendarEventPoints(teamId, eventId)),
          );
        }
      });

      return { ...result.event, changedFields: result.changedFields };
    },

    async deleteCalendarEvent(
      id: string,
      opts: { recurrenceEditMode?: RecurrenceEditMode } = {},
    ): Promise<boolean> {
      await ensureMember();

      const deleted = await db.transaction(async (tx) => {
        if (!(await lockCalendarEventMutation(tx, id, opts.recurrenceEditMode))) return false;
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
        const requestedRecurrenceMode =
          opts.recurrenceEditMode ?? (current.recurringParentId ? 'single' : 'series');
        const recurrenceMode: RecurrenceEditMode = !current.recurringParentId
          ? 'series'
          : requestedRecurrenceMode;

        if (current.recurringParentId && recurrenceMode !== 'single') {
          const parentId = current.recurringParentId;
          const splitAt = current.originalStartAt ?? current.startAt;
          const [parent] = await tx
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.id, parentId),
                eq(calendarEvents.teamId, teamId),
                isNull(calendarEvents.deletedAt),
                calendarWriteVisibility,
              ),
            )
            .limit(1);
          const parentRow = parent as CalendarEventRow | undefined;
          if (!parentRow) throw new Error('Recurring parent not found');
          const deletedIds: string[] = [];
          if (recurrenceMode === 'this_and_future') {
            await tx
              .update(calendarEvents)
              .set({
                rrule: parentRow.rrule ? rruleUntil(parentRow.rrule, splitAt) : parentRow.rrule,
                updatedAt: new Date(),
              })
              .where(eq(calendarEvents.id, parentId));
            const futureChildren = await tx
              .select({ id: calendarEvents.id })
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.teamId, teamId),
                  eq(calendarEvents.recurringParentId, parentId),
                  gte(calendarEvents.originalStartAt, splitAt),
                  isNull(calendarEvents.deletedAt),
                ),
              );
            deletedIds.push(...futureChildren.map((child) => child.id));
            await tombstoneLinkedRawEventsForCalendarEventIds(tx, { teamId, eventIds: deletedIds });
            await tx
              .update(calendarEvents)
              .set({ deletedAt: new Date(), updatedAt: new Date(), isException: true })
              .where(
                and(
                  eq(calendarEvents.teamId, teamId),
                  eq(calendarEvents.recurringParentId, parentId),
                  gte(calendarEvents.originalStartAt, splitAt),
                  isNull(calendarEvents.deletedAt),
                ),
              );
          } else {
            await tx
              .update(calendarEvents)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(calendarEvents.id, parentId));
            const childRows = await tx
              .select({ id: calendarEvents.id })
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.teamId, teamId),
                  eq(calendarEvents.recurringParentId, parentId),
                  isNull(calendarEvents.deletedAt),
                ),
              );
            deletedIds.push(...childRows.map((child) => child.id));
            await tombstoneLinkedRawEventsForCalendarEventIds(tx, { teamId, eventIds: deletedIds });
            await tx
              .update(calendarEvents)
              .set({ deletedAt: new Date(), updatedAt: new Date(), isException: true })
              .where(
                and(
                  eq(calendarEvents.teamId, teamId),
                  eq(calendarEvents.recurringParentId, parentId),
                  isNull(calendarEvents.deletedAt),
                ),
              );
            await tombstoneCalendarRawEventIds(
              tx,
              [parentRow.startAtRawEventId, parentRow.scheduledRawEventId].filter(
                (rid): rid is string => rid !== null && rid.length > 0,
              ),
            );
          }
          const cancelledText = `Cancelled: ${parentRow.title}`;
          const [cancelledRawEvent] = await tx
            .insert(rawEvents)
            .values({
              teamId,
              authorUserId: userId,
              source: 'calendar',
              contentText: cancelledText,
              occurredAt: new Date(),
              visibility: parentRow.visibility,
              visibilityUserIds: parentRow.visibilityUserIds,
              visibilityOwnerUserId: parentRow.createdByUserId,
              sourceMetadata: sourceMetadataWithConversationArtifacts(
                {
                  calendar_event_id: parentId,
                  action: 'cancelled',
                  recurrence_edit_mode: recurrenceMode,
                  ...buildCalendarSourcePayloadMetadata(
                    calendarPayloadInputFromRow(parentRow),
                    'cancelled',
                  ),
                  ...(recurrenceMode === 'this_and_future'
                    ? { original_start_at: splitAt.toISOString() }
                    : {}),
                },
                cancelledText,
              ),
            })
            .returning({ id: rawEvents.id });
          if (cancelledRawEvent?.id) {
            await normalizeCalendarRawEventIds(tx, { teamId, rawEventIds: [cancelledRawEvent.id] });
            await reconcileLinkArtifactsForRawEvent(tx, {
              teamId,
              rawEventId: cancelledRawEvent.id,
              text: cancelledText,
            });
          }
          return {
            deleted: true,
            deletedEventIds:
              recurrenceMode === 'this_and_future' ? deletedIds : [parentId, ...deletedIds],
          };
        }

        await tx
          .update(calendarEvents)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
            ...(current.recurringParentId ? { isException: true } : {}),
          })
          .where(eq(calendarEvents.id, id));

        let deletedChildIds: string[] = [];
        if (
          !current.recurringParentId &&
          (recurrenceMode === 'series' || recurrenceMode === 'single')
        ) {
          const childRows = await tx
            .select({ id: calendarEvents.id })
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                eq(calendarEvents.recurringParentId, id),
                isNull(calendarEvents.deletedAt),
              ),
            );
          deletedChildIds = childRows.map((child) => child.id);
          await tombstoneLinkedRawEventsForCalendarEventIds(tx, {
            teamId,
            eventIds: deletedChildIds,
          });
          await tx
            .update(calendarEvents)
            .set({ deletedAt: new Date(), updatedAt: new Date(), isException: true })
            .where(
              and(
                eq(calendarEvents.teamId, teamId),
                eq(calendarEvents.recurringParentId, id),
                isNull(calendarEvents.deletedAt),
              ),
            );
        }

        await tombstoneCalendarRawEventIds(
          tx,
          [row.startAtRawEventId, row.scheduledRawEventId].filter(
            (rid): rid is string => rid !== null && rid.length > 0,
          ),
        );

        const cancelledText = `Cancelled: ${row.title}`;
        const [cancelledRawEvent] = await tx
          .insert(rawEvents)
          .values({
            teamId,
            authorUserId: userId,
            source: 'calendar',
            contentText: cancelledText,
            occurredAt: new Date(),
            visibility: row.visibility,
            visibilityUserIds: row.visibilityUserIds,
            visibilityOwnerUserId: row.createdByUserId,
            sourceMetadata: sourceMetadataWithConversationArtifacts(
              {
                calendar_event_id: id,
                action: 'cancelled',
                ...buildCalendarSourcePayloadMetadata(
                  calendarPayloadInputFromRow(row as CalendarEventRow),
                  'cancelled',
                ),
              },
              cancelledText,
            ),
          })
          .returning({ id: rawEvents.id });
        if (cancelledRawEvent?.id) {
          await normalizeCalendarRawEventIds(tx, { teamId, rawEventIds: [cancelledRawEvent.id] });
          await reconcileLinkArtifactsForRawEvent(tx, {
            teamId,
            rawEventId: cancelledRawEvent.id,
            text: cancelledText,
          });
        }

        return { deleted: true, deletedEventIds: [id, ...deletedChildIds] };
      });

      if (deleted) {
        await runOrDeferPostCommit(() =>
          deleteCalendarEventPointsForIds(teamId, deleted.deletedEventIds),
        );
      }

      return Boolean(deleted);
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
        .select({
          id: calendarEventEntities.id,
          calendarEventId: calendarEventEntities.calendarEventId,
          entityId: calendarEventEntities.entityId,
          teamId: calendarEventEntities.teamId,
          relationshipType: calendarEventEntities.relationshipType,
          createdAt: calendarEventEntities.createdAt,
        })
        .from(calendarEventEntities)
        .innerJoin(calendarEvents, eq(calendarEvents.id, calendarEventEntities.calendarEventId))
        .where(
          and(
            eq(calendarEventEntities.calendarEventId, calendarEventId),
            eq(calendarEventEntities.teamId, teamId),
            eq(calendarEvents.teamId, teamId),
            isNull(calendarEvents.deletedAt),
            calendarWriteVisibility,
          ),
        )
        .orderBy(asc(calendarEventEntities.createdAt));
    },

    async listLinkedObjectsForEvents(
      calendarEventIds: string[],
    ): Promise<CalendarLinkedObjectRow[]> {
      await ensureMember();
      const ids = uniqueIds(calendarEventIds);
      if (ids.length === 0) return [];

      const rows = await db
        .select({
          calendarEventId: calendarEventEntities.calendarEventId,
          id: entities.id,
          canonicalName: entities.canonicalName,
          metadata: entities.metadata,
          type: entities.type,
          relationshipType: calendarEventEntities.relationshipType,
          createdAt: calendarEventEntities.createdAt,
        })
        .from(calendarEventEntities)
        .innerJoin(entities, eq(entities.id, calendarEventEntities.entityId))
        .innerJoin(calendarEvents, eq(calendarEvents.id, calendarEventEntities.calendarEventId))
        .where(
          and(
            eq(calendarEventEntities.teamId, teamId),
            inArray(calendarEventEntities.calendarEventId, ids),
            eq(entities.teamId, teamId),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
            eq(calendarEvents.teamId, teamId),
            isNull(calendarEvents.deletedAt),
            calendarWriteVisibility,
          ),
        )
        .orderBy(
          asc(calendarEventEntities.createdAt),
          asc(entities.canonicalName),
          asc(entities.id),
        );

      return rows.map((row) => ({
        calendarEventId: row.calendarEventId,
        id: row.id,
        title: displayObjectTitle({
          canonicalName: row.canonicalName,
          metadata: recordFromUnknown(row.metadata),
        }),
        type: row.type,
        relationshipType: row.relationshipType,
      }));
    },

    async materializeRecurringEvent(
      id: string,
      opts: Omit<MaterializeRecurringEventsInput, 'parentId'> = {},
    ): Promise<string[]> {
      await ensureMember();
      const [parent] = await db
        .select({ visibility: calendarEvents.visibility })
        .from(calendarEvents)
        .where(and(eq(calendarEvents.id, id), eq(calendarEvents.teamId, teamId)))
        .limit(1);
      const ids = await db.transaction((tx) => materializeParentById(tx, id, opts));
      if (parent?.visibility === 'team') {
        await enqueueCalendarEventEmbeddings(teamId, ids);
      }
      return ids;
    },

    async materializeRecurringEvents(opts: MaterializeRecurringEventsInput = {}): Promise<number> {
      await ensureMember();
      let count = 0;
      const teamVisibleIds: string[] = [];
      let lastParentId: string | null = null;

      for (;;) {
        const conditions = [
          eq(calendarEvents.teamId, teamId),
          isNull(calendarEvents.deletedAt),
          isNull(calendarEvents.recurringParentId),
          sql`${calendarEvents.rrule} IS NOT NULL`,
        ];
        if (opts.parentId) conditions.push(eq(calendarEvents.id, opts.parentId));
        if (lastParentId) conditions.push(gt(calendarEvents.id, lastParentId));
        const parents = await db
          .select()
          .from(calendarEvents)
          .where(and(...conditions))
          .orderBy(asc(calendarEvents.id))
          .limit(RECURRING_PARENT_PAGE_SIZE);

        await db.transaction(async (tx) => {
          for (const parent of parents) {
            const ids = await materializeParent(tx, parent as CalendarEventRow, opts);
            count += ids.length;
            if (parent.visibility === 'team') teamVisibleIds.push(...ids);
          }
        });

        if (parents.length < RECURRING_PARENT_PAGE_SIZE || opts.parentId) break;
        lastParentId = parents[parents.length - 1]?.id ?? null;
        if (!lastParentId) break;
      }

      await enqueueCalendarEventEmbeddings(teamId, teamVisibleIds);
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
        defaultTimezone: 'Europe/Helsinki',
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
        if (assertValidTimezone(patch.defaultTimezone) !== patch.defaultTimezone) {
          throw new Error(`Invalid calendar timezone: ${patch.defaultTimezone}`);
        }
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
