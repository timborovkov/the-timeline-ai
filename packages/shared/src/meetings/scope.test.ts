import { PGlite } from '@electric-sql/pglite';
import { Temporal } from '@js-temporal/polyfill';
import {
  calendarEvents,
  meetingCaptureConfirmations,
  meetings,
  meetingTranscriptChunks,
  rawEvents,
  savedMeetingAliases,
  savedMeetings,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { detectMeetingPlatform } from '#src/meetings/scope.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function nextUtcWeekday(from: Date, weekday: number): Date {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const delta = (weekday - day.getUTCDay() + 7) % 7;
  day.setUTCDate(day.getUTCDate() + delta);
  return day;
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@x');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_B}', 'b@x');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');`,
  );
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_B}', 'member');`,
  );
}

describe('meetings scope', () => {
  let pg: PGlite;
  // drizzle pglite db (loosely typed because of the runtime client)
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await seed(pg);
    db = drizzle(pg);
  });

  it('detects meeting platforms only for trusted meeting hosts', () => {
    expect(detectMeetingPlatform('https://meet.google.com/abc-defg-hij')).toBe('meet');
    expect(detectMeetingPlatform('https://teams.microsoft.com/l/meetup-join/abc')).toBe('teams');
    expect(detectMeetingPlatform('https://us02web.zoom.us/j/123')).toBe('zoom');
    expect(detectMeetingPlatform('https://meet.google.com.evil.example/abc-defg-hij')).toBeNull();
    expect(
      detectMeetingPlatform('https://teams.microsoft.com.evil.example/l/meetup-join/abc'),
    ).toBeNull();
    expect(detectMeetingPlatform('https://zoom.us.evil.example/j/123')).toBeNull();
  });

  it('createMeeting persists row with defaults and team scoping', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/abc',
    });
    expect(m.teamId).toBe(TEAM_ID);
    expect(m.status).toBe('pending');
    expect(m.defaultVisibility).toBe('team');
    expect(m.provider).toBe('recall');
  });

  it('enforces Saved Meeting visibility for lists and command resolution', async () => {
    const ownerScope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const otherScope = withTeam(db as never, TEAM_ID, USER_B).meetings;
    const privateSaved = await ownerScope.createSavedMeeting({
      title: 'Private founder sync',
      meetingUrl: 'https://meet.google.com/fou-ndr-syn',
      aliases: ['founders'],
      permissionConfirmed: true,
      defaultVisibility: 'private',
    });
    const visibleSaved = await ownerScope.createSavedMeeting({
      title: 'Team daily',
      meetingUrl: 'https://meet.google.com/tea-mdaily',
      aliases: ['daily'],
      permissionConfirmed: true,
      defaultVisibility: 'team',
    });

    await expect(ownerScope.getSavedMeeting(privateSaved.id)).resolves.toMatchObject({
      id: privateSaved.id,
    });
    await expect(otherScope.getSavedMeeting(privateSaved.id)).resolves.toBeNull();
    await expect(otherScope.listSavedMeetings()).resolves.toEqual([
      expect.objectContaining({ id: visibleSaved.id }),
    ]);
    await expect(otherScope.resolveSavedMeeting('founders')).resolves.toEqual({ kind: 'none' });
    const resolvedVisible = await otherScope.resolveSavedMeeting('daily');
    expect(resolvedVisible.kind).toBe('one');
    expect(resolvedVisible.savedMeeting?.id).toBe(visibleSaved.id);
  });

  it('appendMeetingChunk writes chunk with idempotency (no per-chunk raw_event)', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
    });
    const r1 = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'hello world',
      startMs: 0,
      endMs: 1500,
      providerChunkId: 'utt-1',
    });
    expect(r1).not.toBeNull();
    expect(r1?.deduplicated).toBe(false);
    expect(r1?.chunkId).toBeDefined();

    // Idempotent second call with the same providerChunkId returns dedup=true.
    const r2 = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'hello world',
      startMs: 0,
      endMs: 1500,
      providerChunkId: 'utt-1',
    });
    expect(r2?.deduplicated).toBe(true);
    expect(r2?.chunkId).toBe(r1?.chunkId);

    // Underlying row counts confirm no duplicates.
    const chunkRows = await db
      .select()
      .from(meetingTranscriptChunks)
      .where(eq(meetingTranscriptChunks.meetingId, m.id));
    expect(chunkRows).toHaveLength(1);
  });

  it('appendMeetingChunk links late chunks to an existing finalized meeting event', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
      metadata: {
        summary: 'Old summary',
        summary_model: 'test-model',
        action_items: [{ text: 'Old action', owner: null }],
      },
    });
    await db
      .update(meetings)
      .set({ participants: [{ name: 'Alice' }, { name: 'Bob', email: 'bob@example.com' }] })
      .where(eq(meetings.id, m.id));
    await scope.updateMeetingStatus(m.id, 'completed');
    const eventRows = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_A,
        source: 'meeting',
        contentText: 'Meeting (no transcript)',
        occurredAt: new Date('2026-05-25T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          meeting_id: m.id,
          meeting_chunk_provider_id: `meeting-finalized:${m.id}`,
          chunk_count: 0,
          summary: 'Old summary',
          action_items: [{ text: 'Old action', owner: null }],
        },
      })
      .returning({ id: rawEvents.id });
    const rawEventId = eventRows[0]?.id;
    if (!rawEventId) throw new Error('missing raw event');
    const calendarRows = await db
      .insert(calendarEvents)
      .values({
        teamId: TEAM_ID,
        createdByUserId: USER_A,
        title: 'Zoom with Meeting Bot: Planning',
        description:
          'Meeting: /app/meetings/test\n\nSummary: Old summary\n\nAction items: Old action',
        startAt: new Date('2026-05-25T10:00:00Z'),
        endAt: new Date('2026-05-25T10:30:00Z'),
        timezone: 'UTC',
        location: 'https://zoom.us/j/1',
        visibility: 'team',
        metadata: {
          source: 'meeting_bot',
          meeting_id: m.id,
          summary: 'Old summary',
          action_items: [{ text: 'Old action', owner: null }],
        },
      })
      .returning({ id: calendarEvents.id });
    const calendarEventId = calendarRows[0]?.id;
    if (!calendarEventId) throw new Error('missing calendar event');
    const calendarRawRows = await db
      .insert(rawEvents)
      .values([
        {
          teamId: TEAM_ID,
          authorUserId: USER_A,
          source: 'calendar',
          contentText: 'Scheduled: Zoom with Meeting Bot: Planning',
          occurredAt: new Date('2026-05-25T09:55:00Z'),
          visibility: 'team',
          sourceMetadata: {
            calendar_event_id: calendarEventId,
            action: 'scheduled',
            meeting_id: m.id,
            source: 'meeting_bot',
            summary: 'Old summary',
            action_items: [{ text: 'Old action', owner: null }],
          },
        },
        {
          teamId: TEAM_ID,
          authorUserId: USER_A,
          source: 'calendar',
          contentText:
            'Zoom with Meeting Bot: Planning | Summary: Old summary | Action items: Old action',
          occurredAt: new Date('2026-05-25T10:00:00Z'),
          visibility: 'team',
          sourceMetadata: {
            calendar_event_id: calendarEventId,
            action: 'event',
            meeting_id: m.id,
            source: 'meeting_bot',
            summary: 'Old summary',
            action_items: [{ text: 'Old action', owner: null }],
          },
        },
      ])
      .returning({ id: rawEvents.id });
    await db
      .update(calendarEvents)
      .set({
        scheduledRawEventId: calendarRawRows[0]?.id,
        startAtRawEventId: calendarRawRows[1]?.id,
      })
      .where(eq(calendarEvents.id, calendarEventId));

    const result = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'late utterance',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-late',
    });
    expect(result?.refreshedCalendarEventId).toBe(calendarEventId);

    const chunkRows = await db
      .select()
      .from(meetingTranscriptChunks)
      .where(
        eq(meetingTranscriptChunks.id, result?.chunkId ?? '00000000-0000-0000-0000-000000000000'),
      );
    expect(chunkRows[0]?.rawEventId).toBe(rawEventId);

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.contentText).toBe('[1s] Alice: late utterance');
    const eventMeta = event?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.chunk_count).toBe(1);
    expect(eventMeta.speakers).toEqual(['Alice']);
    expect(eventMeta.summary).toBeUndefined();
    expect(eventMeta.action_items).toBeUndefined();
    expect(eventMeta.summary_stale_at).toBeTypeOf('string');

    const meeting = (await db.select().from(meetings).where(eq(meetings.id, m.id)))[0];
    const meetingMeta = meeting?.metadata as Record<string, unknown>;
    expect(meetingMeta.summary).toBeUndefined();
    expect(meetingMeta.summary_model).toBeUndefined();
    expect(meetingMeta.action_items).toBeUndefined();
    expect(meetingMeta.summary_stale_at).toBeTypeOf('string');

    const calendar = (
      await db.select().from(calendarEvents).where(eq(calendarEvents.id, calendarEventId))
    )[0];
    expect(calendar?.description).toContain(
      'Summary stale: transcript changed after finalization.',
    );
    expect(calendar?.description).not.toContain('Old summary');
    expect(calendar?.description).not.toContain('Old action');
    const calendarMeta = calendar?.metadata as Record<string, unknown>;
    expect(calendarMeta.summary).toBeUndefined();
    expect(calendarMeta.action_items).toBeUndefined();
    expect(calendarMeta.summary_stale_at).toBeTypeOf('string');

    const linkedCalendarRawRows = await db
      .select()
      .from(rawEvents)
      .where(eq(rawEvents.source, 'calendar'));
    for (const row of linkedCalendarRawRows) {
      const meta = row.sourceMetadata as Record<string, unknown>;
      expect(meta.summary).toBeUndefined();
      expect(meta.action_items).toBeUndefined();
      expect(meta.extracted_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_at).toBeTypeOf('string');
      expect(meta.extraction_skipped_reason).toBe('generated_from_meeting_bot');
      expect(meta.extraction_model_version).toBeTypeOf('string');
      expect(meta.summary_stale_at).toBeTypeOf('string');
    }
    const startRaw = linkedCalendarRawRows.find(
      (row) => (row.sourceMetadata as Record<string, unknown>).action === 'event',
    );
    expect(startRaw?.contentText).toContain(
      'Summary stale: transcript changed after finalization.',
    );
    expect(startRaw?.contentText).toContain('Participants: Alice, Bob');
    expect(startRaw?.contentText).not.toContain('\n\n');
    expect(startRaw?.contentText?.match(/https:\/\/zoom\.us\/j\/1/g)).toHaveLength(1);
    expect(startRaw?.contentText).not.toContain('Old summary');
    expect(startRaw?.contentText).not.toContain('Old action');
  });

  it('appendMeetingChunk replay after finalize preserves existing summary metadata', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'zoom',
      meetingUrl: 'https://zoom.us/j/1',
      metadata: {
        summary: 'Final summary',
        summary_model: 'test-model',
        action_items: [{ text: 'Final action', owner: null }],
      },
    });
    const first = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'already captured',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-replay',
    });
    expect(first?.deduplicated).toBe(false);
    await scope.updateMeetingStatus(m.id, 'completed');
    const eventRows = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM_ID,
        authorUserId: USER_A,
        source: 'meeting',
        contentText: '[1s] Alice: already captured',
        occurredAt: new Date('2026-05-25T10:00:00Z'),
        visibility: 'team',
        sourceMetadata: {
          meeting_id: m.id,
          meeting_chunk_provider_id: `meeting-finalized:${m.id}`,
          chunk_count: 1,
          summary: 'Final summary',
          action_items: [{ text: 'Final action', owner: null }],
        },
      })
      .returning({ id: rawEvents.id });
    const rawEventId = eventRows[0]?.id;
    if (!rawEventId) throw new Error('missing raw event');

    const replay = await scope.appendMeetingChunk({
      meetingId: m.id,
      speaker: 'Alice',
      text: 'already captured',
      startMs: 1000,
      endMs: 2000,
      providerChunkId: 'utt-replay',
    });

    expect(replay?.deduplicated).toBe(true);
    const chunk = (
      await db
        .select()
        .from(meetingTranscriptChunks)
        .where(eq(meetingTranscriptChunks.id, replay?.chunkId ?? ''))
    )[0];
    expect(chunk?.rawEventId).toBe(rawEventId);

    const event = (await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)))[0];
    expect(event?.contentText).toBe('[1s] Alice: already captured');
    const eventMeta = event?.sourceMetadata as Record<string, unknown>;
    expect(eventMeta.summary).toBe('Final summary');
    expect(eventMeta.action_items).toEqual([{ text: 'Final action', owner: null }]);
    expect(eventMeta.summary_stale_at).toBeUndefined();

    const meeting = (await db.select().from(meetings).where(eq(meetings.id, m.id)))[0];
    const meetingMeta = meeting?.metadata as Record<string, unknown>;
    expect(meetingMeta.summary).toBe('Final summary');
    expect(meetingMeta.summary_model).toBe('test-model');
    expect(meetingMeta.action_items).toEqual([{ text: 'Final action', owner: null }]);
    expect(meetingMeta.summary_stale_at).toBeUndefined();
  });

  it('updateMeetingStatus flips status and merges metadata', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/x',
    });
    await scope.updateMeetingStatus(m.id, 'active', {
      providerBotId: 'bot-1',
      startedAt: new Date('2026-05-25T10:00:00Z'),
      metadata: { last_status: 'in_call_recording' },
    });
    const rows = await db.select().from(meetings).where(eq(meetings.id, m.id));
    const row = rows[0];
    expect(row?.status).toBe('active');
    expect(row?.providerBotId).toBe('bot-1');
    expect((row?.metadata as Record<string, unknown>).last_status).toBe('in_call_recording');
  });

  it('records and sums meeting minutes per month', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const m = await scope.createMeeting({
      platform: 'meet',
      meetingUrl: 'https://meet.google.com/x',
    });
    await scope.recordMeetingMinutes(m.id, 30);
    // Idempotent: second call must not double-count.
    await scope.recordMeetingMinutes(m.id, 99);
    const total = await scope.getCurrentMonthMinutes();
    expect(total).toBe(30);
  });

  it('creates saved meetings with normalized unique aliases and resolves alias before title', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const daily = await scope.createSavedMeeting({
      title: 'Internal daily meeting',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      aliases: ['Daily', 'team sync'],
      permissionConfirmed: true,
    });
    const other = await scope.createSavedMeeting({
      title: 'Daily',
      meetingUrl: 'https://zoom.us/j/123456',
      aliases: ['client-sync'],
      permissionConfirmed: true,
    });

    const aliases = await db
      .select()
      .from(savedMeetingAliases)
      .where(eq(savedMeetingAliases.savedMeetingId, daily.id));
    expect(aliases.map((alias) => alias.normalizedAlias).sort()).toEqual(['daily', 'team sync']);

    const resolved = await scope.resolveSavedMeeting('daily');
    expect(resolved).toMatchObject({ kind: 'one', savedMeeting: { id: daily.id } });
    const titleResolved = await scope.resolveSavedMeeting('Internal Daily Meeting');
    expect(titleResolved).toMatchObject({ kind: 'one', savedMeeting: { id: daily.id } });
    expect(other.id).not.toBe(daily.id);

    await expect(
      scope.createSavedMeeting({
        title: 'Another daily',
        meetingUrl: 'https://meet.google.com/xyz-abcd-efg',
        aliases: ['TEAM sync'],
        permissionConfirmed: true,
      }),
    ).rejects.toThrow();
  });

  it('materializes scheduled saved meeting occurrences, links generated calendar rows, and skips once', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const now = new Date();
    const day = nextUtcWeekday(now, now.getUTCDay());
    const occurrenceTime = new Date(day.getTime() + 60 * 60 * 1000);
    const time = `${String(occurrenceTime.getUTCHours()).padStart(2, '0')}:${String(
      occurrenceTime.getUTCMinutes(),
    ).padStart(2, '0')}`;
    const saved = await scope.createSavedMeeting({
      title: 'Launch review',
      meetingUrl: 'https://meet.google.com/lau-nch-rev',
      aliases: ['launch'],
      permissionConfirmed: true,
      scheduleConfig: {
        weekdays: [occurrenceTime.getUTCDay()],
        times: [time],
        timezone: 'UTC',
        joinOffsetMinutes: 2,
      },
      durationMinutes: 45,
      autoJoinEnabled: true,
    });

    const scheduled = await db.select().from(meetings).where(eq(meetings.savedMeetingId, saved.id));
    expect(scheduled.length).toBeGreaterThan(0);
    await expect(scope.materializeSavedMeetingOccurrences(saved.id)).resolves.toBe(0);
    const afterRematerialize = await db
      .select()
      .from(meetings)
      .where(eq(meetings.savedMeetingId, saved.id));
    expect(afterRematerialize).toHaveLength(scheduled.length);
    expect(scheduled[0]).toMatchObject({
      status: 'scheduled',
      title: 'Launch review',
      meetingUrl: 'https://meet.google.com/lau-nch-rev',
      defaultVisibility: 'team',
    });
    expect(scheduled[0]?.scheduledEndAt?.getTime()).toBe(
      (scheduled[0]?.scheduledStartAt?.getTime() ?? 0) + 45 * 60_000,
    );
    expect(scheduled[0]?.linkedCalendarEventId).toBeTruthy();

    const calendar = (
      await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, scheduled[0]?.linkedCalendarEventId ?? ''))
    )[0];
    expect(calendar?.title).toBe('Launch review');
    expect(calendar?.metadata).toMatchObject({
      source: 'saved_meeting',
      saved_meeting_id: saved.id,
      capture_status: 'scheduled',
    });

    const scheduledStartAt = scheduled[0]?.scheduledStartAt;
    if (!scheduledStartAt) throw new Error('expected scheduled start');
    const nearby = await scope.findNearbyScheduledOccurrence(saved.id, scheduledStartAt);
    expect(nearby?.id).toBe(scheduled[0]?.id);
    const tooEarlyForManualJoin = await scope.findNearbyScheduledOccurrence(
      saved.id,
      new Date(scheduledStartAt.getTime() - 10 * 60_000),
      2 * 60_000,
    );
    expect(tooEarlyForManualJoin).toBeNull();
    await expect(scope.skipScheduledMeeting(scheduled[0]?.id ?? '')).resolves.toBe(true);
    const skipped = (
      await db
        .select()
        .from(meetings)
        .where(eq(meetings.id, scheduled[0]?.id ?? ''))
    )[0];
    expect(skipped?.status).toBe('skipped');
    const skippedCalendar = (
      await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, scheduled[0]?.linkedCalendarEventId ?? ''))
    )[0];
    expect(skippedCalendar?.metadata).toMatchObject({ capture_status: 'skipped' });
  });

  it('materializes saved meeting schedules in the configured timezone', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const timezone = 'Europe/Helsinki';
    const target = Temporal.Now.instant()
      .toZonedDateTimeISO(timezone)
      .add({ hours: 2 })
      .with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
    const time = `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;

    const saved = await scope.createSavedMeeting({
      title: 'Helsinki sync',
      meetingUrl: 'https://meet.google.com/hel-sin-ki',
      permissionConfirmed: true,
      scheduleConfig: {
        weekdays: [target.dayOfWeek % 7],
        times: [time],
        timezone,
        joinOffsetMinutes: 2,
      },
      autoJoinEnabled: true,
    });

    const scheduled = await db.select().from(meetings).where(eq(meetings.savedMeetingId, saved.id));
    const expectedStart = new Date(target.toInstant().epochMilliseconds).toISOString();
    expect(scheduled.map((row) => row.scheduledStartAt?.toISOString())).toContain(expectedStart);
  });

  it('removes generated future calendar entries when a saved meeting schedule is edited', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const target = Temporal.Now.instant()
      .toZonedDateTimeISO('UTC')
      .add({ hours: 2 })
      .with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
    const originalTime = `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;
    const updatedTime = `${String((target.hour + 1) % 24).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;
    const saved = await scope.createSavedMeeting({
      title: 'Schedule edit sync',
      meetingUrl: 'https://meet.google.com/sch-edt-syn',
      permissionConfirmed: true,
      scheduleConfig: {
        weekdays: [target.dayOfWeek % 7],
        times: [originalTime],
        timezone: 'UTC',
        joinOffsetMinutes: 2,
      },
      autoJoinEnabled: true,
    });
    const [scheduled] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.savedMeetingId, saved.id));
    if (!scheduled?.linkedCalendarEventId) throw new Error('expected generated calendar event');

    await scope.updateSavedMeeting(saved.id, {
      title: saved.title,
      scheduleConfig: {
        weekdays: [target.dayOfWeek % 7],
        times: [updatedTime],
        timezone: 'UTC',
        joinOffsetMinutes: 5,
      },
      autoJoinEnabled: true,
    });

    const oldCalendar = (
      await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, scheduled.linkedCalendarEventId))
    )[0];
    expect(oldCalendar?.deletedAt).toBeInstanceOf(Date);
    expect(oldCalendar?.metadata).toMatchObject({
      capture_status: 'cancelled',
      cancelled_by_schedule_update: true,
    });
    const remainingScheduled = await db
      .select()
      .from(meetings)
      .where(eq(meetings.savedMeetingId, saved.id));
    expect(remainingScheduled.length).toBeGreaterThan(0);
    expect(remainingScheduled.map((row) => row.scheduledStartAt?.toISOString())).not.toContain(
      scheduled.scheduledStartAt?.toISOString(),
    );
  });

  it('cancels future scheduled captures and generated calendar entries when a saved meeting is archived', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const target = Temporal.Now.instant()
      .toZonedDateTimeISO('UTC')
      .add({ hours: 2 })
      .with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
    const time = `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;
    const saved = await scope.createSavedMeeting({
      title: 'Archive sync',
      meetingUrl: 'https://meet.google.com/arc-hiv-syn',
      permissionConfirmed: true,
      scheduleConfig: {
        weekdays: [target.dayOfWeek % 7],
        times: [time],
        timezone: 'UTC',
      },
      autoJoinEnabled: true,
    });
    const [scheduled] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.savedMeetingId, saved.id));
    if (!scheduled?.linkedCalendarEventId) throw new Error('expected generated calendar event');

    await expect(scope.archiveSavedMeeting(saved.id)).resolves.toBe(true);

    const [cancelled] = await db.select().from(meetings).where(eq(meetings.id, scheduled.id));
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.metadata).toMatchObject({
      capture_status: 'cancelled',
      cancelled_by_saved_meeting_archive: true,
    });
    const calendar = (
      await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, scheduled.linkedCalendarEventId))
    )[0];
    expect(calendar?.deletedAt).toBeInstanceOf(Date);
    expect(calendar?.metadata).toMatchObject({
      capture_status: 'cancelled',
      cancelled_by_saved_meeting_archive: true,
    });
  });

  it('tracks raw-url quick join confirmations through pending, expiry, and cancellation states', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const confirmation = await scope.createMeetingCaptureConfirmation({
      source: 'telegram',
      meetingUrl: 'https://meet.google.com/raw-url-now',
      title: 'Raw URL',
      sourceContext: { telegram_chat_id: 42, telegram_user_id: 7 },
    });
    expect(confirmation.status).toBe('pending');
    expect(confirmation.platform).toBe('meet');
    const claimed = await scope.claimPendingMeetingCaptureConfirmation(confirmation.id);
    expect(claimed?.id).toBe(confirmation.id);
    await expect(scope.claimPendingMeetingCaptureConfirmation(confirmation.id)).resolves.toBeNull();

    const pending = await scope.findPendingMeetingCaptureConfirmation({
      source: 'telegram',
      sourceContext: { telegram_chat_id: 42, telegram_user_id: 7 },
    });
    expect(pending).toBeNull();

    await scope.markMeetingCaptureConfirmation(confirmation.id, 'cancelled');
    const cancelled = (
      await db
        .select()
        .from(meetingCaptureConfirmations)
        .where(eq(meetingCaptureConfirmations.id, confirmation.id))
    )[0];
    expect(cancelled?.status).toBe('cancelled');
    await expect(
      scope.findPendingMeetingCaptureConfirmation({
        source: 'telegram',
        sourceContext: { telegram_chat_id: 42, telegram_user_id: 7 },
      }),
    ).resolves.toBeNull();
  });

  it('pauses and resets saved meeting failure counters', async () => {
    const scope = withTeam(db as never, TEAM_ID, USER_A).meetings;
    const saved = await scope.createSavedMeeting({
      title: 'Failure-prone sync',
      meetingUrl: 'https://meet.google.com/fai-lur-esx',
      permissionConfirmed: true,
    });
    await scope.recordSavedMeetingJoinFailure(saved.id, 'no_show');
    await scope.recordSavedMeetingJoinFailure(saved.id, 'failure');
    const third = await scope.recordSavedMeetingJoinFailure(saved.id, 'failure');
    expect(third).toMatchObject({ paused: true, consecutiveFailureCount: 3 });
    const paused = (await db.select().from(savedMeetings).where(eq(savedMeetings.id, saved.id)))[0];
    expect(paused?.autoJoinEnabled).toBe(false);
    expect(paused?.autoJoinPausedAt).toBeInstanceOf(Date);

    await scope.resetSavedMeetingFailures(saved.id);
    const reset = (await db.select().from(savedMeetings).where(eq(savedMeetings.id, saved.id)))[0];
    expect(reset?.consecutiveFailureCount).toBe(0);
    expect(reset?.autoJoinPausedAt).toBeNull();
  });
});
