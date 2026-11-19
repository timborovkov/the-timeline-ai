// Verify the workspace boundaries and retry behavior of recovery, imports, reminders, OCR, and saved views.
import {
  calendarEvents,
  entities,
  meetings,
  notifications,
  rawEvents,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  VISION_BUDGET_ESTIMATE_CENTS,
  VisionBudgetDeferredError,
} from '#src/billing/vision-budget.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
let fixture: ResettablePGliteTestDb;
let db: Db;

beforeAll(async () => {
  fixture = await createResettablePGliteTestDb(async (pg) => {
    const seeded = drizzle(pg);
    await seeded.insert(teams).values({ id: TEAM, name: 'Test workspace', slug: 'test-workspace' });
    await seeded.insert(users).values([
      { id: OWNER, email: 'owner@example.test' },
      { id: MEMBER, email: 'member@example.test' },
      { id: OTHER, email: 'outside@example.test' },
    ]);
    await seeded.insert(teamMembers).values([
      { teamId: TEAM, userId: OWNER, role: 'owner' },
      { teamId: TEAM, userId: MEMBER, role: 'member' },
    ]);
  });
  db = drizzle(fixture.pg) as unknown as Db;
}, 30_000);
beforeEach(async () => fixture.reset());
afterAll(async () => fixture.close());

describe('workspace follow-through', () => {
  it('creates one recovery attempt, preserves the original, and protects private recordings', async () => {
    const [original] = await db
      .insert(meetings)
      .values({
        teamId: TEAM,
        createdByUserId: OWNER,
        platform: 'meet',
        meetingUrl: 'https://meet.google.com/test-room',
        status: 'no_show',
        defaultVisibility: 'private',
      })
      .returning();
    if (!original) throw new Error('Missing fixture');
    const owner = withTeam(db, TEAM, OWNER);
    const member = withTeam(db, TEAM, MEMBER);
    expect(await member.meetings.prepareMeetingRecovery(original.id, 'rejoin', true)).toBeNull();
    const [first, second] = await Promise.all([
      owner.meetings.prepareMeetingRecovery(original.id, 'rejoin', true),
      owner.meetings.prepareMeetingRecovery(original.id, 'rejoin', true),
    ]);
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    expect(first?.defaultVisibility).toBe('private');
    expect((await owner.meetings.getMeeting(original.id))?.status).toBe('no_show');
  });

  it('starts reminders off, checks event-wide blocks, and deduplicates retries', async () => {
    const now = new Date();
    const [event] = await db
      .insert(calendarEvents)
      .values({
        teamId: TEAM,
        createdByUserId: OWNER,
        title: 'Planning',
        startAt: new Date(now.getTime() + 60_000),
        endAt: new Date(now.getTime() + 3_600_000),
      })
      .returning();
    if (!event) throw new Error('Missing fixture');
    const organizer = withTeam(db, TEAM, OWNER).calendar.reminders;
    const member = withTeam(db, TEAM, MEMBER).calendar.reminders;
    expect((await member.getPreference(event.id))?.leadMinutes).toBeNull();
    expect(await member.deliver(event.id, now)).toBe(false);
    expect(await member.setPreference(event.id, 15)).toBe(true);
    expect(await member.setBlock(event.id, true, false)).toBe(false);
    expect(await organizer.setBlock(event.id, true, false)).toBe(true);
    expect(await member.deliver(event.id, now)).toBe(false);
    await organizer.setBlock(event.id, false, false);
    expect(await member.deliver(event.id, now)).toBe(true);
    expect(await member.deliver(event.id, now)).toBe(false);
    await db
      .update(calendarEvents)
      .set({ visibility: 'private' })
      .where(eq(calendarEvents.id, event.id));
    expect(await member.getPreference(event.id)).toBeNull();
    expect(await member.deliver(event.id, now)).toBeNull();
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it('reports visible index evidence and excludes another member’s private deliveries', async () => {
    await db.insert(rawEvents).values([
      {
        teamId: TEAM,
        source: 'web',
        contentText: 'Visible note',
        sourceMetadata: {
          embedded_at: new Date().toISOString(),
          embedding_model: TIMELINE_MODELS.embedding.id,
        },
      },
      {
        teamId: TEAM,
        source: 'web',
        contentText: 'Restricted note',
        visibility: 'private',
        visibilityOwnerUserId: MEMBER,
      },
    ]);
    await expect(withTeam(db, TEAM, MEMBER).sourceHealth.read()).rejects.toThrow();
    const health = await withTeam(db, TEAM, OWNER).sourceHealth.read();
    expect(health.sources).toMatchObject([{ key: 'web', total: 1, indexed: 1 }]);
  });

  it('reserves OCR budget only once across concurrent candidates', async () => {
    const scope = withTeam(db, TEAM, OWNER);
    await expect(withTeam(db, TEAM, MEMBER).billing.setVisionBudget(0)).rejects.toThrow();
    await scope.billing.setVisionBudget(VISION_BUDGET_ESTIMATE_CENTS);
    const reserve = (operationId: string) =>
      scope.billing.reserve({
        operationId,
        meterId: 'ai',
        reservedChargeCents: 1,
        reservedNativeUnits: 1,
        metadata: { operation_class: 'vision', vision_budget_cents: VISION_BUDGET_ESTIMATE_CENTS },
      });
    const results = await Promise.allSettled([reserve('ocr:1'), reserve('ocr:2')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.some(
        (result) =>
          result.status === 'rejected' && result.reason instanceof VisionBudgetDeferredError,
      ),
    ).toBe(true);
  });

  it('establishes a personal baseline, reports newly matching items once, and rechecks them before delivery', async () => {
    await db
      .insert(entities)
      .values({
        teamId: TEAM,
        type: 'task',
        canonicalName: 'Existing launch task',
        status: 'open',
      });
    const owner = withTeam(db, TEAM, OWNER).savedViews;
    const member = withTeam(db, TEAM, MEMBER).savedViews;
    const id = await owner.create({
      title: 'Open launch work',
      collection: 'tasks',
      targetId: null,
      filters: { status: 'open' },
    });
    if (!id) throw new Error('Missing view');
    expect(await member.manage(id, { type: 'delete' })).toBe(false);
    expect((await owner.list())[0]?.notify).toBe(false);
    expect(await owner.manage(id, { type: 'notify', enabled: true })).toBe(true);
    const [added] = await db
      .insert(entities)
      .values({
        teamId: TEAM,
        type: 'task',
        canonicalName: 'New launch task',
        status: 'open',
      })
      .returning();
    if (!added) throw new Error('Missing task');
    const firstWindow = new Date(Date.now() + 60_000);
    const laterWindow = new Date(firstWindow.getTime() + 60_000);
    const result = await owner.evaluate(firstWindow, firstWindow);
    expect(result).toEqual([{ viewId: id, itemIds: [added.id] }]);
    expect(await owner.evaluate(firstWindow, firstWindow)).toEqual(result);
    expect(await owner.evaluate(laterWindow, laterWindow)).toEqual([]);
    expect(await owner.visibleDigestChanges(result, firstWindow, firstWindow)).toMatchObject([
      { count: 1 },
    ]);
    await db.update(entities).set({ status: 'done' }).where(eq(entities.id, added.id));
    expect(await owner.visibleDigestChanges(result, firstWindow, firstWindow)).toEqual([]);
  });

  it('syncs one Google calendar privately and applies incremental cancellations', async () => {
    const previous = {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY,
    };
    process.env.GOOGLE_CLIENT_ID = 'calendar-test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'calendar-test-secret';
    process.env.SECRETS_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const { resetEnvForTests } = await import('#src/env.js');
    resetEnvForTests();
    const now = new Date();
    const eventId = 'provider-event';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com')
        return Response.json({ access_token: 'fixture' });
      if (url.pathname.endsWith('calendarList')) {
        return Response.json({
          items: [
            {
              id: 'selected',
              summary: 'Selected calendar',
              timeZone: 'Europe/London',
              accessRole: 'owner',
            },
          ],
        });
      }
      return Response.json(
        url.searchParams.has('syncToken')
          ? { items: [{ id: eventId, status: 'cancelled' }], nextSyncToken: 'next' }
          : {
              items: [
                {
                  id: eventId,
                  summary: 'Protected calendar title',
                  start: { dateTime: new Date(now.getTime() + 3600_000).toISOString() },
                  end: { dateTime: new Date(now.getTime() + 7200_000).toISOString() },
                },
              ],
              nextSyncToken: 'first',
            },
      );
    });
    try {
      const owner = withTeam(db, TEAM, OWNER).calendar;
      const member = withTeam(db, TEAM, MEMBER).calendar;
      await owner.google.connect('encrypted-fixture');
      expect(await owner.google.selectCalendar('selected')).toBe(true);
      await owner.google.sync(new Date(now.getTime() + 1000));
      expect((await owner.google.getImport())?.lastSyncAt).toBeTruthy();
      const range = { from: now, to: new Date(now.getTime() + 86400_000) };
      expect(await owner.listCalendarEvents(range)).toMatchObject([
        { title: 'Protected calendar title', visibility: 'private' },
      ]);
      expect(await member.listCalendarEvents(range)).toMatchObject([
        { title: 'Busy', redacted: true },
      ]);
      await owner.google.sync(new Date(now.getTime() + 3600_000));
      expect(await owner.listCalendarEvents(range)).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetEnvForTests();
    }
  });
});
