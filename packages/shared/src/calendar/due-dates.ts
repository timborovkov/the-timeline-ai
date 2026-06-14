import {
  type Db,
  type boardItems,
  type boards,
  calendarEventEntities,
  calendarEvents,
  type entities,
  notifications,
  users,
} from '@timeline/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  insertCalendarRawEvents,
  tombstoneCalendarRawEventIds,
  updateCalendarRawEvents,
} from '#src/calendar/raw-events.js';
import { childLogger } from '#src/logger.js';
import { enqueueCalendarEventEmbedJob } from '#src/queue/queues.js';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;

const log = childLogger('calendar:due-dates');

interface DueDateTarget {
  source: 'object' | 'board_item';
  teamId: string;
  entityId: string;
  objectName: string;
  dueAt: Date | null;
  responsibleUserId: string | null;
  objectType?: string;
  boardId?: string;
  boardName?: string;
  boardItemId?: string;
  inactive?: boolean;
}

interface DueDateActor {
  kind: 'user' | 'agent' | 'system';
  userId?: string | null;
}

function eventEnd(dueAt: Date): Date {
  return new Date(dueAt.getTime() + 30 * 60 * 1000);
}

function sourcePredicate(target: DueDateTarget) {
  const sourceId =
    target.source === 'board_item'
      ? sql`${calendarEvents.metadata} ->> 'board_item_id' = ${target.boardItemId ?? ''}`
      : sql`${calendarEvents.metadata} ->> 'entity_id' = ${target.entityId}`;
  return and(
    eq(calendarEvents.teamId, target.teamId),
    sql`${calendarEvents.metadata} ->> 'kind' = 'due_date'`,
    sql`${calendarEvents.metadata} ->> 'source' = ${target.source}`,
    sourceId,
  );
}

async function displayName(db: DbOrTx, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? row?.email ?? userId;
}

function titleFor(target: DueDateTarget, responsible: string | null): string {
  const suffix = responsible ? ` - ${responsible}` : '';
  if (target.source === 'board_item') {
    return `Due: ${target.objectName}${suffix}`;
  }
  return `Due: ${target.objectName}${suffix}`;
}

function descriptionFor(target: DueDateTarget, responsible: string | null): string {
  return [
    target.source === 'board_item' && target.boardName ? `Board: ${target.boardName}` : null,
    responsible ? `Responsible: ${responsible}` : null,
    target.objectType ? `Object type: ${target.objectType}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

async function syncDueDateCalendarEvent(db: DbOrTx, target: DueDateTarget): Promise<void> {
  const [existing] = await db
    .select({
      id: calendarEvents.id,
      scheduledRawEventId: calendarEvents.scheduledRawEventId,
      startAtRawEventId: calendarEvents.startAtRawEventId,
    })
    .from(calendarEvents)
    .where(sourcePredicate(target))
    .limit(1);

  if (!target.dueAt || target.inactive) {
    if (existing) {
      await db
        .update(calendarEvents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.teamId, target.teamId)));
      await tombstoneCalendarRawEventIds(
        db,
        [existing.scheduledRawEventId, existing.startAtRawEventId].filter(
          (id): id is string => id !== null && id.length > 0,
        ),
      );
    }
    return;
  }
  const activeTarget = { ...target, dueAt: target.dueAt };

  const responsible = await displayName(db, target.responsibleUserId);
  const title = titleFor(target, responsible);
  const description = descriptionFor(target, responsible);
  const metadata = {
    kind: 'due_date',
    source: target.source,
    entity_id: target.entityId,
    object_type: target.objectType ?? null,
    responsible_user_id: target.responsibleUserId,
    board_id: target.boardId ?? null,
    board_item_id: target.boardItemId ?? null,
  };

  if (existing) {
    const [updated] = await db
      .update(calendarEvents)
      .set({
        title,
        description: description || null,
        startAt: activeTarget.dueAt,
        endAt: eventEnd(activeTarget.dueAt),
        timezone: 'UTC',
        allDay: false,
        showAs: 'free',
        visibility: 'team',
        visibilityUserIds: null,
        metadata,
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.teamId, target.teamId)))
      .returning({
        id: calendarEvents.id,
        scheduledRawEventId: calendarEvents.scheduledRawEventId,
        startAtRawEventId: calendarEvents.startAtRawEventId,
      });
    if (updated) {
      await ensureDueDateRawEvents(db, activeTarget, updated, title, description);
      await ensureDueDateEntityLink(db, target, updated.id);
      await enqueueDueDateCalendarEventEmbedding(target.teamId, updated.id);
    }
    return;
  }

  const [created] = await db
    .insert(calendarEvents)
    .values({
      teamId: target.teamId,
      createdByUserId: target.responsibleUserId,
      title,
      description: description || null,
      startAt: activeTarget.dueAt,
      endAt: eventEnd(activeTarget.dueAt),
      timezone: 'UTC',
      allDay: false,
      showAs: 'free',
      visibility: 'team',
      metadata,
    })
    .returning({
      id: calendarEvents.id,
      scheduledRawEventId: calendarEvents.scheduledRawEventId,
      startAtRawEventId: calendarEvents.startAtRawEventId,
    });

  if (created) {
    await ensureDueDateRawEvents(db, activeTarget, created, title, description);
    await ensureDueDateEntityLink(db, target, created.id);
    await enqueueDueDateCalendarEventEmbedding(target.teamId, created.id);
  }
}

async function ensureDueDateEntityLink(
  db: DbOrTx,
  target: DueDateTarget,
  calendarEventId: string,
): Promise<void> {
  await db
    .insert(calendarEventEntities)
    .values({
      calendarEventId,
      entityId: target.entityId,
      teamId: target.teamId,
      relationshipType: 'due_date',
    })
    .onConflictDoNothing();
}

async function ensureDueDateRawEvents(
  db: DbOrTx,
  target: DueDateTarget & { dueAt: Date },
  event: {
    id: string;
    scheduledRawEventId: string | null;
    startAtRawEventId: string | null;
  },
  title: string,
  description: string,
): Promise<void> {
  const args = {
    teamId: target.teamId,
    userId: target.responsibleUserId,
    calendarEventId: event.id,
    title,
    description: description || null,
    startAt: target.dueAt,
    endAt: eventEnd(target.dueAt),
    timezone: 'UTC',
    location: null,
    visibility: 'team' as const,
    visibilityUserIds: null,
  };

  if (event.scheduledRawEventId && event.startAtRawEventId) {
    await updateCalendarRawEvents(db, {
      scheduledRawEventId: event.scheduledRawEventId,
      startAtRawEventId: event.startAtRawEventId,
      title,
      description: description || null,
      startAt: target.dueAt,
      endAt: eventEnd(target.dueAt),
      timezone: 'UTC',
      location: null,
      visibility: 'team',
      visibilityUserIds: null,
    });
    return;
  }

  const { scheduledRawEventId, startAtRawEventId } = await insertCalendarRawEvents(db, args);
  await db
    .update(calendarEvents)
    .set({ scheduledRawEventId, startAtRawEventId })
    .where(and(eq(calendarEvents.id, event.id), eq(calendarEvents.teamId, target.teamId)));
}

async function enqueueDueDateCalendarEventEmbedding(
  teamId: string,
  eventId: string,
): Promise<void> {
  try {
    await enqueueCalendarEventEmbedJob(teamId, eventId);
  } catch (err) {
    log.warn({ err, teamId, eventId }, 'due-date calendar embed enqueue failed');
  }
}

export async function syncObjectDueDateCalendarEvent(
  db: DbOrTx,
  object: Pick<
    typeof entities.$inferSelect,
    | 'id'
    | 'teamId'
    | 'canonicalName'
    | 'type'
    | 'dueAt'
    | 'assigneeUserId'
    | 'ownerUserId'
    | 'archivedAt'
    | 'mergedIntoId'
    | 'status'
  >,
): Promise<void> {
  await syncDueDateCalendarEvent(db, {
    source: 'object',
    teamId: object.teamId,
    entityId: object.id,
    objectName: object.canonicalName,
    objectType: object.type,
    dueAt: object.dueAt,
    responsibleUserId: object.assigneeUserId ?? object.ownerUserId,
    inactive:
      object.archivedAt !== null ||
      object.mergedIntoId !== null ||
      object.status === 'done' ||
      object.status === 'cancelled' ||
      object.status === 'suggested' ||
      (object.type !== 'task' && object.type !== 'follow_up'),
  });
}

export async function tombstoneObjectDueDateCalendarEventsForEntities(
  db: DbOrTx,
  args: { teamId: string; entityIds: string[] },
): Promise<void> {
  if (args.entityIds.length === 0) return;
  const rows = await db
    .select({
      id: calendarEvents.id,
      scheduledRawEventId: calendarEvents.scheduledRawEventId,
      startAtRawEventId: calendarEvents.startAtRawEventId,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, args.teamId),
        sql`${calendarEvents.metadata} ->> 'kind' = 'due_date'`,
        sql`${calendarEvents.metadata} ->> 'source' = 'object'`,
        sql`${calendarEvents.metadata} ->> 'entity_id' IN (${sql.join(
          args.entityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  if (rows.length === 0) return;
  await db
    .update(calendarEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      inArray(
        calendarEvents.id,
        rows.map((row) => row.id),
      ),
    );
  await tombstoneCalendarRawEventIds(
    db,
    rows.flatMap((row) =>
      [row.scheduledRawEventId, row.startAtRawEventId].filter(
        (id): id is string => id !== null && id.length > 0,
      ),
    ),
  );
}

export async function syncBoardItemDueDateCalendarEvent(
  db: DbOrTx,
  item: Pick<
    typeof boardItems.$inferSelect,
    'id' | 'teamId' | 'entityId' | 'boardId' | 'dueAt' | 'responsibleUserId' | 'archivedAt'
  >,
  object: Pick<typeof entities.$inferSelect, 'canonicalName' | 'type' | 'archivedAt'>,
  board: Pick<typeof boards.$inferSelect, 'name' | 'archivedAt'>,
): Promise<void> {
  await syncDueDateCalendarEvent(db, {
    source: 'board_item',
    teamId: item.teamId,
    entityId: item.entityId,
    objectName: object.canonicalName,
    objectType: object.type,
    dueAt: item.dueAt,
    responsibleUserId: item.responsibleUserId,
    boardId: item.boardId,
    boardName: board.name,
    boardItemId: item.id,
    inactive: item.archivedAt !== null || board.archivedAt !== null || object.archivedAt !== null,
  });
}

export async function notifyObjectDueDate(
  db: DbOrTx,
  object: Pick<
    typeof entities.$inferSelect,
    | 'id'
    | 'teamId'
    | 'canonicalName'
    | 'type'
    | 'dueAt'
    | 'assigneeUserId'
    | 'ownerUserId'
    | 'archivedAt'
    | 'mergedIntoId'
    | 'status'
  >,
  actor: DueDateActor,
): Promise<void> {
  if (!object.dueAt || (object.type !== 'task' && object.type !== 'follow_up')) return;
  if (
    object.archivedAt ||
    object.mergedIntoId ||
    object.status === 'done' ||
    object.status === 'cancelled' ||
    object.status === 'suggested'
  ) {
    return;
  }
  const userId = object.assigneeUserId ?? object.ownerUserId;
  if (!userId) return;
  await db.insert(notifications).values({
    teamId: object.teamId,
    userId,
    kind: 'task_due',
    entityId: object.id,
    summary: `${object.canonicalName} is due ${object.dueAt.toISOString().slice(0, 10)}`,
    payload: {
      entity_id: object.id,
      type: object.type,
      due_at: object.dueAt.toISOString(),
      actor_kind: actor.kind,
      actor_user_id: actor.userId ?? null,
    },
  });
}

export async function notifyBoardItemDueDate(
  db: DbOrTx,
  item: Pick<
    typeof boardItems.$inferSelect,
    'id' | 'teamId' | 'entityId' | 'boardId' | 'dueAt' | 'responsibleUserId' | 'archivedAt'
  >,
  object: Pick<typeof entities.$inferSelect, 'canonicalName'>,
  board: Pick<typeof boards.$inferSelect, 'name' | 'archivedAt'>,
  actor: DueDateActor,
): Promise<void> {
  if (!item.dueAt || !item.responsibleUserId || item.archivedAt || board.archivedAt) return;
  await db.insert(notifications).values({
    teamId: item.teamId,
    userId: item.responsibleUserId,
    kind: 'board_item_due',
    entityId: item.entityId,
    summary: `${object.canonicalName} on ${board.name} is due ${item.dueAt.toISOString().slice(0, 10)}`,
    payload: {
      entity_id: item.entityId,
      board_id: item.boardId,
      board_item_id: item.id,
      due_at: item.dueAt.toISOString(),
      actor_kind: actor.kind,
      actor_user_id: actor.userId ?? null,
    },
  });
}
