import { PGlite } from '@electric-sql/pglite';
import { calendarEventEntities, calendarEvents, entities, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

interface DeletePointsForSourceInput {
  sourceId: string;
}

const fakes = vi.hoisted(() => ({
  enqueueCalendarEventEmbedJob: vi.fn(),
  deletePoints: vi.fn(),
  deletePointsForSource: vi.fn(),
}));

vi.mock('#src/queue/queues.js', () => ({
  enqueueCalendarEventEmbedJob: fakes.enqueueCalendarEventEmbedJob,
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary-job' }),
}));
vi.mock('#src/qdrant/client.js', () => ({
  getQdrantClient: vi.fn(() => ({
    deletePoints: fakes.deletePoints,
    deletePointsForSource: fakes.deletePointsForSource,
  })),
}));

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CALENDAR_EVENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SCHEDULED_RAW_EVENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const START_RAW_EVENT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ENTITY_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_ID}', 'a@x');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_B_ID}', 'b@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');`,
  );
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_B_ID}', 'member');`,
  );
}

describe('calendar scope', () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
    fakes.enqueueCalendarEventEmbedJob.mockReset();
    fakes.enqueueCalendarEventEmbedJob.mockResolvedValue(undefined);
    fakes.deletePoints.mockReset();
    fakes.deletePoints.mockResolvedValue(undefined);
    fakes.deletePointsForSource.mockReset();
    fakes.deletePointsForSource.mockResolvedValue(undefined);
  });

  it('defaults missing team calendar settings to Helsinki workspace time', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await expect(scope.calendar.getCalendarSettings()).resolves.toMatchObject({
      teamId: TEAM_ID,
      defaultReminderMinutes: 15,
      defaultVisibility: 'team',
      defaultTimezone: 'Europe/Helsinki',
    });
  });

  it('keeps the occurrence timeline row rich enough for search hydration', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const event = await scope.calendar.createCalendarEvent({
      title: 'Launch review',
      description: 'Final launch readiness pass',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'Europe/Tallinn',
      location: 'Room 3',
      visibility: 'private',
    });

    let rows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    let occurrence = rows.find((row) => row.id === event.startAtRawEventId);
    expect(occurrence?.contentText).toBe(
      'Launch review | Final launch readiness pass | at Room 3 | 2026-05-27T09:00:00.000Z to 2026-05-27T10:00:00.000Z | (Europe/Tallinn)',
    );

    await scope.calendar.updateCalendarEvent(event.id, {
      description: 'Updated readiness pass',
      location: 'Room 4',
      endAt: new Date('2026-05-27T10:30:00Z'),
    });

    rows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    occurrence = rows.find((row) => row.id === event.startAtRawEventId);
    expect(occurrence?.contentText).toBe(
      'Launch review | Updated readiness pass | at Room 4 | 2026-05-27T09:00:00.000Z to 2026-05-27T10:30:00.000Z | (Europe/Tallinn)',
    );
  });

  it('persists team-visible creates and updates when embedding enqueue is unavailable', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    fakes.enqueueCalendarEventEmbedJob.mockRejectedValue(new Error('redis down'));

    const event = await scope.calendar.createCalendarEvent({
      title: 'Queue-degraded planning',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      visibility: 'team',
    });

    expect(event.id).toBeTruthy();
    expect(fakes.enqueueCalendarEventEmbedJob).toHaveBeenCalledWith(TEAM_ID, event.id);

    const updated = await scope.calendar.updateCalendarEvent(event.id, {
      title: 'Queue-degraded planning updated',
    });

    expect(updated?.title).toBe('Queue-degraded planning updated');
    expect(fakes.enqueueCalendarEventEmbedJob).toHaveBeenCalledTimes(2);

    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.id, event.id));
    expect(rows[0]?.title).toBe('Queue-degraded planning updated');
  });

  it('materializes recurring daily calls except Saturdays', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR',
    });

    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-09T00:00:00Z'),
      limit: 20,
    });
    const activeStarts = rows
      .filter((row) => row.title === 'Daily call')
      .map((row) => row.startAt.toISOString());

    expect(parent.rrule).toBe('RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR');
    expect(activeStarts).toEqual([
      '2026-07-01T16:00:00.000Z',
      '2026-07-02T16:00:00.000Z',
      '2026-07-03T16:00:00.000Z',
      '2026-07-05T16:00:00.000Z',
      '2026-07-06T16:00:00.000Z',
      '2026-07-07T16:00:00.000Z',
      '2026-07-08T16:00:00.000Z',
    ]);
    const embeddedIds = fakes.enqueueCalendarEventEmbedJob.mock.calls.map(
      ([, eventId]) => eventId as string,
    );
    for (const row of rows) {
      expect(embeddedIds).toContain(row.id);
    }
  });

  it('lists paged calendar events with search without exposing redacted private details', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);

    await ownerScope.calendar.createCalendarEvent({
      title: 'Launch planning',
      description: 'Discuss project timeline',
      startAt: new Date('2026-07-01T09:00:00Z'),
      endAt: new Date('2026-07-01T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await ownerScope.calendar.createCalendarEvent({
      title: 'Customer review',
      startAt: new Date('2026-07-02T09:00:00Z'),
      endAt: new Date('2026-07-02T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await teammateScope.calendar.createCalendarEvent({
      title: 'Sensitive private meeting',
      description: 'Secret acquisition',
      startAt: new Date('2026-07-03T09:00:00Z'),
      endAt: new Date('2026-07-03T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'private',
    });

    const firstPage = await ownerScope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 1,
      offset: 1,
    });
    expect(firstPage.total).toBe(3);
    expect(firstPage.events).toHaveLength(1);
    expect(firstPage.events[0]?.title).toBe('Customer review');

    const searched = await ownerScope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      search: 'project',
    });
    expect(searched.total).toBe(1);
    expect(searched.events[0]?.title).toBe('Launch planning');

    const hiddenPrivateSearch = await ownerScope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      search: 'acquisition',
    });
    expect(hiddenPrivateSearch.total).toBe(0);

    const busySearch = await ownerScope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      search: 'busy',
    });
    expect(busySearch.total).toBe(1);
    expect(busySearch.events[0]).toMatchObject({
      title: 'Busy',
      description: null,
      location: null,
      redacted: true,
    });
  });

  it('can filter paged calendar events by start boundary for non-overlapping buckets', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);

    await scope.calendar.createCalendarEvent({
      title: 'Overnight incident',
      startAt: new Date('2026-07-01T22:00:00Z'),
      endAt: new Date('2026-07-02T02:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
    });
    await scope.calendar.createCalendarEvent({
      title: 'Today standup',
      startAt: new Date('2026-07-02T09:00:00Z'),
      endAt: new Date('2026-07-02T09:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
    });

    const today = new Date('2026-07-02T00:00:00Z');
    const future = await scope.calendar.listCalendarEventPage({
      from: today,
      to: new Date('2026-07-03T00:00:00Z'),
      startFrom: today,
    });
    expect(future.events.map((event) => event.title)).toEqual(['Today standup']);

    const past = await scope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: today,
      startTo: today,
      order: 'desc',
    });
    expect(past.events.map((event) => event.title)).toEqual(['Overnight incident']);

    const all = await scope.calendar.listCalendarEventPage({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-03T00:00:00Z'),
    });
    expect(all.events.map((event) => event.title)).toEqual(['Overnight incident', 'Today standup']);
  });

  it('uses the parent creator for raw timeline rows materialized by the worker scope', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    const workerScope = withTeam(db as never, TEAM_ID, '00000000-0000-0000-0000-000000000000', {
      skipMembershipCheck: true,
    });
    const parent = await ownerScope.calendar.createCalendarEvent({
      title: 'Private daily call',
      startAt: new Date('2026-01-01T16:00:00Z'),
      endAt: new Date('2026-01-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'private',
      rrule: 'FREQ=DAILY;COUNT=2',
    });

    await workerScope.calendar.materializeRecurringEvent(parent.id, {
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-03T00:00:00Z'),
    });

    const rows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.recurringParentId, parent.id));
    expect(rows).toHaveLength(1);
    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    const linked = rawRows.filter((row) =>
      [rows[0]?.scheduledRawEventId, rows[0]?.startAtRawEventId].includes(row.id),
    );
    expect(linked).toHaveLength(2);
    expect(linked.every((row) => row.authorUserId === USER_B_ID)).toBe(true);
    expect(linked.every((row) => row.visibilityOwnerUserId === USER_B_ID)).toBe(true);
  });

  it('does not re-enqueue embeddings for already materialized recurrence rows', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    fakes.enqueueCalendarEventEmbedJob.mockClear();

    await expect(
      scope.calendar.materializeRecurringEvent(parent.id, {
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-07-04T00:00:00Z'),
      }),
    ).resolves.toEqual([]);

    expect(fakes.enqueueCalendarEventEmbedJob).not.toHaveBeenCalled();
  });

  it('materializes recurring parents beyond the first parent page', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parentRows = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 1000).padStart(12, '0')}`,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: `Paged daily call ${index}`,
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team' as const,
      rrule: 'RRULE:FREQ=DAILY;COUNT=2',
      metadata: {},
    }));
    await db.insert(calendarEvents).values(parentRows);
    fakes.enqueueCalendarEventEmbedJob.mockClear();

    await expect(
      scope.calendar.materializeRecurringEvents({
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-07-03T00:00:00Z'),
      }),
    ).resolves.toBe(501);

    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_ID));
    const children = rows.filter((row) => row.recurringParentId !== null);
    expect(children).toHaveLength(501);
    expect(children.some((row) => row.recurringParentId === parentRows[500]?.id)).toBe(true);
    expect(fakes.enqueueCalendarEventEmbedJob).toHaveBeenCalledTimes(501);
  }, 30_000);

  it('moves one recurring occurrence without changing sibling occurrences', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-02T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();

    await scope.calendar.updateCalendarEvent(occurrence?.id ?? '', {
      startAt: new Date('2026-07-02T15:00:00Z'),
      endAt: new Date('2026-07-02T15:30:00Z'),
      recurrenceEditMode: 'single',
    });

    await scope.calendar.materializeRecurringEvent(parent.id, {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
    });
    const updatedRows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const starts = updatedRows.map((row) => row.startAt.toISOString()).sort();
    const moved = updatedRows.find((row) => row.id === occurrence?.id);
    expect(moved).toMatchObject({ isException: true });
    expect(starts).toContain('2026-07-02T15:00:00.000Z');
    expect(starts).not.toContain('2026-07-02T16:00:00.000Z');
    expect(starts).toContain('2026-07-03T16:00:00.000Z');
  });

  it('keeps a cancelled recurring occurrence cancelled after rematerialization', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-03T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();

    await expect(scope.calendar.deleteCalendarEvent(occurrence?.id ?? '')).resolves.toBe(true);
    await scope.calendar.materializeRecurringEvent(parent.id, {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
    });
    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });

    expect(active.map((row) => row.startAt.toISOString())).not.toContain(
      '2026-07-03T16:00:00.000Z',
    );
  });

  it('marks deleted generated occurrences as exceptions so they do not reappear', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-02T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();
    await scope.calendar.deleteCalendarEvent(occurrence?.id ?? '', {
      recurrenceEditMode: 'series',
    });

    await scope.calendar.materializeRecurringEvent(parent.id, {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
    });

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 20,
    });
    expect(active.map((row) => row.startAt.toISOString())).not.toContain(
      '2026-07-02T16:00:00.000Z',
    );
    const allRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    const deletedOccurrence = allRows.find((row) => row.id === occurrence?.id);
    expect(deletedOccurrence?.deletedAt).toBeInstanceOf(Date);
    expect(deletedOccurrence?.isException).toBe(true);
  });

  it('recreates active children after a whole-series update rematerializes the parent', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const beforeRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    const oldChildRawIds = beforeRows
      .filter((row) => row.recurringParentId === parent.id && !row.isException)
      .flatMap((row) => [row.scheduledRawEventId, row.startAtRawEventId])
      .filter((rawEventId): rawEventId is string => rawEventId !== null);

    await scope.calendar.updateCalendarEvent(parent.id, {
      title: 'Daily planning',
      recurrenceEditMode: 'series',
    });

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const planningStarts = active
      .filter((row) => row.title === 'Daily planning')
      .map((row) => row.startAt.toISOString())
      .sort();

    expect(planningStarts).toEqual([
      '2026-07-01T16:00:00.000Z',
      '2026-07-02T16:00:00.000Z',
      '2026-07-03T16:00:00.000Z',
      '2026-07-04T16:00:00.000Z',
      '2026-07-05T16:00:00.000Z',
    ]);

    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    for (const rawEventId of oldChildRawIds) {
      expect(rawRows.find((row) => row.id === rawEventId)?.sourceMetadata).toMatchObject({
        deleted: true,
      });
    }

    await scope.calendar.materializeRecurringEvent(parent.id, {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
    });
    const afterSecondMaterialize = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const activeChildStarts = afterSecondMaterialize
      .filter((row) => row.recurringParentId === parent.id)
      .map((row) => row.originalStartAt?.toISOString());
    expect(new Set(activeChildStarts).size).toBe(activeChildStarts.length);
    expect(afterSecondMaterialize).toHaveLength(5);
  });

  it('treats single-scope edits on recurring parents as series edits', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=3',
    });

    await scope.calendar.updateCalendarEvent(parent.id, {
      startAt: new Date('2026-07-01T15:00:00Z'),
      endAt: new Date('2026-07-01T15:30:00Z'),
      recurrenceEditMode: 'single',
    });

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 20,
    });
    const starts = active.map((row) => row.startAt.toISOString()).sort();
    expect(starts).toEqual([
      '2026-07-01T15:00:00.000Z',
      '2026-07-02T15:00:00.000Z',
      '2026-07-03T15:00:00.000Z',
    ]);
    expect(starts).not.toContain('2026-07-02T16:00:00.000Z');
  });

  it('splits this-and-future recurring edits into a new parent series', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=6',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-08T00:00:00Z'),
      limit: 20,
    });
    const futureRawIds = rows
      .filter(
        (row) =>
          row.recurringParentId === parent.id &&
          row.originalStartAt !== null &&
          row.originalStartAt >= new Date('2026-07-04T16:00:00Z'),
      )
      .flatMap((row) => [row.scheduledRawEventId, row.startAtRawEventId])
      .filter((rawEventId): rawEventId is string => rawEventId !== null);
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-04T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();

    const split = await scope.calendar.updateCalendarEvent(occurrence?.id ?? '', {
      startAt: new Date('2026-07-04T15:00:00Z'),
      endAt: new Date('2026-07-04T15:30:00Z'),
      recurrenceEditMode: 'this_and_future',
    });
    expect(split?.recurringParentId).toBeNull();
    expect(split?.id).not.toBe(parent.id);

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-10T00:00:00Z'),
      limit: 20,
    });
    const starts = active.map((row) => row.startAt.toISOString()).sort();
    expect(starts).toContain('2026-07-03T16:00:00.000Z');
    expect(starts).toContain('2026-07-04T15:00:00.000Z');
    expect(starts).toContain('2026-07-05T15:00:00.000Z');
    expect(starts).toContain('2026-07-06T15:00:00.000Z');
    expect(starts).not.toContain('2026-07-04T16:00:00.000Z');
    expect(starts).not.toContain('2026-07-07T15:00:00.000Z');

    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    for (const rawEventId of futureRawIds) {
      expect(rawRows.find((row) => row.id === rawEventId)?.sourceMetadata).toMatchObject({
        deleted: true,
      });
    }
  });

  it('requires parent write access before splitting this-and-future from an occurrence', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_ID);
    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    const parent = await ownerScope.calendar.createCalendarEvent({
      title: 'Private daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'private',
      rrule: 'FREQ=DAILY;COUNT=4',
    });
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.teamId, TEAM_ID));
    const occurrence = rows.find(
      (row) =>
        row.recurringParentId === parent.id &&
        row.originalStartAt?.toISOString() === '2026-07-02T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();
    await db
      .update(calendarEvents)
      .set({ visibility: 'team' })
      .where(eq(calendarEvents.id, occurrence?.id ?? ''));

    await expect(
      teammateScope.calendar.updateCalendarEvent(occurrence?.id ?? '', {
        startAt: new Date('2026-07-02T15:00:00Z'),
        endAt: new Date('2026-07-02T15:30:00Z'),
        recurrenceEditMode: 'this_and_future',
      }),
    ).rejects.toThrow('Recurring parent not found');

    const parentRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, parent.id));
    expect(parentRows[0]?.rrule).toBe('RRULE:FREQ=DAILY;COUNT=4');
  });

  it('deleting a recurring parent as a single event removes active children and tombstones their timeline rows', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const beforeRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    const childRows = beforeRows.filter((row) => row.recurringParentId === parent.id);
    expect(childRows).toHaveLength(2);
    const childRawIds = childRows
      .flatMap((row) => [row.scheduledRawEventId, row.startAtRawEventId])
      .filter((rawEventId): rawEventId is string => rawEventId !== null);

    await expect(
      scope.calendar.deleteCalendarEvent(parent.id, { recurrenceEditMode: 'single' }),
    ).resolves.toBe(true);

    const afterRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    expect(afterRows.find((row) => row.id === parent.id)?.deletedAt).toBeInstanceOf(Date);
    for (const child of childRows) {
      expect(afterRows.find((row) => row.id === child.id)?.deletedAt).toBeInstanceOf(Date);
    }
    const rawRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    for (const rawEventId of childRawIds) {
      expect(rawRows.find((row) => row.id === rawEventId)?.sourceMetadata).toMatchObject({
        deleted: true,
      });
    }
  });

  it('updates the recurring parent and siblings when editing an occurrence with series scope', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=4',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-05T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-03T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();

    const updated = await scope.calendar.updateCalendarEvent(occurrence?.id ?? '', {
      title: 'Daily planning',
      startAt: new Date('2026-07-03T15:00:00Z'),
      endAt: new Date('2026-07-03T15:30:00Z'),
      recurrenceEditMode: 'series',
    });

    expect(updated?.id).toBe(parent.id);
    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-05T00:00:00Z'),
      limit: 20,
    });
    expect(active.map((row) => row.startAt.toISOString()).sort()).toEqual([
      '2026-07-01T15:00:00.000Z',
      '2026-07-02T15:00:00.000Z',
      '2026-07-03T15:00:00.000Z',
      '2026-07-04T15:00:00.000Z',
    ]);
    expect(active.every((row) => row.title === 'Daily planning')).toBe(true);
  });

  it('rebuilds active exception rows when editing the whole recurring series', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-02T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();
    await scope.calendar.updateCalendarEvent(occurrence?.id ?? '', {
      title: 'Moved daily call',
      startAt: new Date('2026-07-02T15:00:00Z'),
      endAt: new Date('2026-07-02T15:30:00Z'),
      showAs: 'tentative',
      recurrenceEditMode: 'single',
    });

    await scope.calendar.updateCalendarEvent(parent.id, {
      title: 'Daily planning',
      startAt: new Date('2026-07-01T17:00:00Z'),
      endAt: new Date('2026-07-01T17:45:00Z'),
      showAs: 'free',
      recurrenceEditMode: 'series',
    });

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-04T00:00:00Z'),
      limit: 20,
    });
    expect(active.map((row) => row.startAt.toISOString()).sort()).toEqual([
      '2026-07-01T17:00:00.000Z',
      '2026-07-02T17:00:00.000Z',
      '2026-07-03T17:00:00.000Z',
    ]);
    expect(active.every((row) => row.title === 'Daily planning')).toBe(true);
    expect(active.every((row) => row.showAs === 'free')).toBe(true);
    expect(active.some((row) => row.id === occurrence?.id)).toBe(false);

    const allRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    const oldException = allRows.find((row) => row.id === occurrence?.id);
    expect(oldException?.deletedAt).toBeInstanceOf(Date);
    expect(oldException?.isException).toBe(false);
  });

  it('deleting a recurring occurrence with series scope removes the parent and active children', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=4',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-05T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-03T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();

    await expect(
      scope.calendar.deleteCalendarEvent(occurrence?.id ?? '', { recurrenceEditMode: 'series' }),
    ).resolves.toBe(true);

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-05T00:00:00Z'),
      limit: 20,
    });
    expect(active).toHaveLength(0);
    const allRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, TEAM_ID));
    expect(allRows.find((row) => row.id === parent.id)?.deletedAt).toBeInstanceOf(Date);
    for (const row of allRows.filter((item) => item.recurringParentId === parent.id)) {
      expect(row.deletedAt).toBeInstanceOf(Date);
    }
  });

  it('deleting a recurring occurrence with this-and-future scope keeps earlier occurrences', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    const parent = await scope.calendar.createCalendarEvent({
      title: 'Daily call',
      startAt: new Date('2026-07-01T16:00:00Z'),
      endAt: new Date('2026-07-01T16:30:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const rows = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const occurrence = rows.find(
      (row) => row.originalStartAt?.toISOString() === '2026-07-03T16:00:00.000Z',
    );
    expect(occurrence).toBeDefined();
    const futureChildIds = rows
      .filter(
        (row) =>
          row.recurringParentId === parent.id &&
          row.originalStartAt !== null &&
          row.originalStartAt >= new Date('2026-07-03T16:00:00Z'),
      )
      .map((row) => row.id)
      .sort();

    await expect(
      scope.calendar.deleteCalendarEvent(occurrence?.id ?? '', {
        recurrenceEditMode: 'this_and_future',
      }),
    ).resolves.toBe(true);

    const active = await scope.calendar.listCalendarEvents({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-06T00:00:00Z'),
      limit: 20,
    });
    const starts = active.map((row) => row.startAt.toISOString()).sort();
    expect(starts).toEqual(['2026-07-01T16:00:00.000Z', '2026-07-02T16:00:00.000Z']);
    const parentRows = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, parent.id));
    expect(parentRows[0]?.rrule).toContain('UNTIL=20260703T155959Z');

    const deleteSourceCalls = fakes.deletePointsForSource.mock.calls as [
      DeletePointsForSourceInput,
    ][];
    const deletedSourceIds = deleteSourceCalls.map(([input]) => input.sourceId).sort();
    expect(deletedSourceIds).not.toContain(parent.id);
    expect(Array.from(new Set(deletedSourceIds))).toEqual(futureChildIds);
  });

  it('deleteCalendarEvent tombstones both linked timeline rows', async () => {
    await db.insert(rawEvents).values([
      {
        id: SCHEDULED_RAW_EVENT_ID,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'calendar',
        contentText: 'Scheduled: Launch review',
        occurredAt: new Date('2026-05-26T09:00:00Z'),
        visibility: 'team',
        sourceMetadata: { calendar_event_id: CALENDAR_EVENT_ID, action: 'scheduled' },
      },
      {
        id: START_RAW_EVENT_ID,
        teamId: TEAM_ID,
        authorUserId: USER_ID,
        source: 'calendar',
        contentText: 'Launch review',
        occurredAt: new Date('2026-05-27T09:00:00Z'),
        visibility: 'team',
        sourceMetadata: { calendar_event_id: CALENDAR_EVENT_ID, action: 'event' },
      },
    ]);
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Launch review',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      metadata: {},
      scheduledRawEventId: SCHEDULED_RAW_EVENT_ID,
      startAtRawEventId: START_RAW_EVENT_ID,
    });

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(scope.calendar.deleteCalendarEvent(CALENDAR_EVENT_ID)).resolves.toBe(true);

    const timelineRows = await scope.timeline.listEvents({ source: 'calendar' });
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]?.contentText).toBe('Cancelled: Launch review');

    const linkedRows = await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM_ID));
    const linkedMetadata = new Map(
      linkedRows.map((row) => [row.id, row.sourceMetadata as Record<string, unknown>]),
    );
    expect(linkedMetadata.get(SCHEDULED_RAW_EVENT_ID)).toEqual({
      calendar_event_id: CALENDAR_EVENT_ID,
      action: 'scheduled',
      deleted: true,
    });
    expect(linkedMetadata.get(START_RAW_EVENT_ID)).toEqual({
      calendar_event_id: CALENDAR_EVENT_ID,
      action: 'event',
      deleted: true,
    });
  });

  it('getEventWithFacts does not return tombstoned calendar timeline rows', async () => {
    await db.insert(rawEvents).values({
      id: START_RAW_EVENT_ID,
      teamId: TEAM_ID,
      authorUserId: USER_ID,
      source: 'calendar',
      contentText: 'Launch review',
      occurredAt: new Date('2026-05-27T09:00:00Z'),
      visibility: 'team',
      sourceMetadata: {
        calendar_event_id: CALENDAR_EVENT_ID,
        action: 'event',
        deleted: true,
      },
    });

    const scope = withTeam(db as never, TEAM_ID, USER_ID);
    await expect(scope.timeline.getEventWithFacts(START_RAW_EVENT_ID)).resolves.toBeNull();
  });

  it('rejects non-owner visibility changes before mutating the calendar event', async () => {
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Team review',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      metadata: {},
    });

    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    await expect(
      teammateScope.calendar.updateCalendarEvent(CALENDAR_EVENT_ID, {
        visibility: 'specific_users',
        visibilityUserIds: [USER_B_ID],
      }),
    ).rejects.toThrow('Only the visibility owner can change this event');

    const [row] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, CALENDAR_EVENT_ID));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });

  it('rejects non-owner visibility user changes even when visibility value is unchanged', async () => {
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Team review',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      metadata: {},
    });

    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    await expect(
      teammateScope.calendar.updateCalendarEvent(CALENDAR_EVENT_ID, {
        visibility: 'team',
        visibilityUserIds: [USER_B_ID],
      }),
    ).rejects.toThrow('Only the visibility owner can change this event');

    const [row] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, CALENDAR_EVENT_ID));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });

  it('allows non-creator team event edits when an empty visibility user list is a no-op', async () => {
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Team review',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'team',
      metadata: {},
    });

    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    await expect(
      teammateScope.calendar.updateCalendarEvent(CALENDAR_EVENT_ID, {
        reminderMinutes: 30,
        visibility: 'team',
        visibilityUserIds: [],
      }),
    ).resolves.toMatchObject({ reminderMinutes: 30 });

    const [row] = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, CALENDAR_EVENT_ID));
    expect(row?.visibility).toBe('team');
    expect(row?.visibilityUserIds).toBeNull();
  });

  it('unlinkEntity requires write access to the calendar event', async () => {
    await db.insert(entities).values({
      id: ENTITY_ID,
      teamId: TEAM_ID,
      type: 'project',
      canonicalName: 'Launch',
    });
    await db.insert(calendarEvents).values({
      id: CALENDAR_EVENT_ID,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Private launch review',
      startAt: new Date('2026-05-27T09:00:00Z'),
      endAt: new Date('2026-05-27T10:00:00Z'),
      timezone: 'UTC',
      visibility: 'private',
      metadata: {},
    });
    await db.insert(calendarEventEntities).values({
      calendarEventId: CALENDAR_EVENT_ID,
      entityId: ENTITY_ID,
      teamId: TEAM_ID,
    });

    const teammateScope = withTeam(db as never, TEAM_ID, USER_B_ID);
    await expect(teammateScope.calendar.unlinkEntity(CALENDAR_EVENT_ID, ENTITY_ID)).rejects.toThrow(
      'Calendar event not found',
    );

    const rows = await db
      .select()
      .from(calendarEventEntities)
      .where(eq(calendarEventEntities.calendarEventId, CALENDAR_EVENT_ID));
    expect(rows).toHaveLength(1);
  });
});
