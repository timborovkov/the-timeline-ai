import { PGlite } from '@electric-sql/pglite';
import { calendarEventEntities, calendarEvents, entities, rawEvents } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const fakes = vi.hoisted(() => ({
  enqueueCalendarEventEmbedJob: vi.fn(),
}));

vi.mock('#src/queue/queues.js', () => ({
  enqueueCalendarEventEmbedJob: fakes.enqueueCalendarEventEmbedJob,
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
