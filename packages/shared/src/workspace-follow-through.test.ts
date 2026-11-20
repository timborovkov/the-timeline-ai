// Verify the workspace boundaries and retry behavior of recovery, imports, reminders, OCR, and saved views.
import {
  calendarEvents,
  documentChunks,
  documentExtractionAttempts,
  documents,
  documentVersions,
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
import { and, eq, isNull } from 'drizzle-orm';
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
    if (!first) throw new Error('Missing recovery replacement');
    await db
      .update(meetings)
      .set({
        status: 'failed',
        metadata: {
          ...first.metadata,
          join_failed_at: new Date().toISOString(),
          join_error: 'provider_error',
        },
      })
      .where(eq(meetings.id, first.id));
    const retried = await owner.meetings.prepareMeetingRecovery(original.id, 'rejoin', true);
    expect(retried?.id).toBe(first.id);
    expect(retried?.status).toBe('pending');
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

  it('carries a reminder block and personal preference when a series changes time', async () => {
    const override = withTeam(db, TEAM, OWNER).calendar;
    const other = withTeam(db, TEAM, MEMBER).calendar.reminders;
    const startAt = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 2 * 86_400_000);
    const endAt = new Date(startAt.getTime() + 1_800_000);
    const parent = await override.createCalendarEvent({
      title: 'Daily planning',
      startAt,
      endAt,
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;COUNT=3',
    });
    async function childAt(when: Date) {
      const [child] = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.recurringParentId, parent.id),
            eq(calendarEvents.originalStartAt, when),
            isNull(calendarEvents.deletedAt),
          ),
        );
      if (!child) throw new Error('Missing series occurrence');
      return child;
    }
    const occurrence = await childAt(new Date(startAt.getTime() + 86_400_000));
    await other.setPreference(occurrence.id, 15);
    await override.reminders.setBlock(occurrence.id, true, false);
    await override.updateCalendarEvent(parent.id, {
      startAt: new Date(startAt.getTime() + 3_600_000),
      endAt: new Date(endAt.getTime() + 3_600_000),
      recurrenceEditMode: 'series',
    });
    const moved = await childAt(new Date(startAt.getTime() + 86_400_000 + 3_600_000));
    expect(moved.id).not.toBe(occurrence.id);
    expect(await other.getPreference(moved.id)).toMatchObject({
      leadMinutes: 15,
      eventBlocked: true,
    });
  });

  it('preserves replaced text and retries publishing a correction without changing the original object', async () => {
    const [file] = await db
      .insert(documents)
      .values({
        teamId: TEAM,
        name: 'Capture',
        fileKind: 'captured',
        ownerUserId: OWNER,
        visibility: 'private',
      })
      .returning();
    if (!file) throw new Error('Missing fixture');
    const [version] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: file.id,
        version: 1,
        objectKey: 'original/capture',
        processingStatus: 'chunked',
      })
      .returning();
    if (!version) throw new Error('Missing fixture');
    await db
      .update(documents)
      .set({ currentVersionId: version.id })
      .where(eq(documents.id, file.id));
    const [original] = await db
      .insert(documentChunks)
      .values({
        teamId: TEAM,
        documentId: file.id,
        documentVersionId: version.id,
        chunkIndex: 0,
        text: 'Initial extraction',
        tokenCount: 4,
      })
      .returning();
    if (!original) throw new Error('Missing fixture');
    const owner = withTeam(db, TEAM, OWNER).documents;
    const member = withTeam(db, TEAM, MEMBER).documents;
    const request = await owner.requestExtractionCorrection(file.id);
    if (!request) throw new Error('Missing correction');
    await db
      .update(documentExtractionAttempts)
      .set({
        status: 'ready',
        representations: [{ kind: 'source_text', text: 'Corrected extraction' }],
      })
      .where(eq(documentExtractionAttempts.id, request.attemptId));
    expect(await member.applyExtractionCorrection(file.id, request.attemptId)).toBeNull();
    const replacement = await owner.applyExtractionCorrection(file.id, request.attemptId);
    expect(replacement).toMatchObject({ replacedIds: [original.id] });
    expect(await owner.applyExtractionCorrection(file.id, request.attemptId)).toEqual(replacement);
    expect(await owner.getHistoricalDocumentChunk(file.id, version.id, original.id)).toMatchObject({
      text: 'Initial extraction',
    });
    expect(await member.getHistoricalDocumentChunk(file.id, version.id, original.id)).toBeNull();
    expect((await owner.listExtractionCorrections(file.id))[0]?.indexQueuedAt).toBeNull();
    await owner.confirmExtractionCorrectionIndex(request.attemptId);
    expect((await owner.listExtractionCorrections(file.id))[0]?.indexQueuedAt).toBeInstanceOf(Date);
    expect((await owner.getDocumentVersion(version.id))?.objectKey).toBe(version.objectKey);
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
    const scope = withTeam(db, TEAM, OWNER).sourceHealth;
    expect((await scope.read()).sources).toMatchObject([{ key: 'web', total: 1, indexed: 1 }]);
    const [reopened] = await db
      .update(rawEvents)
      .set({
        sourceMetadata: {
          embedded_at: '2025-01-01T00:00:00.000Z',
          visibility_changed_at: '2025-01-02T00:00:00.000Z',
          embedding_model: TIMELINE_MODELS.embedding.id,
        },
      })
      .where(eq(rawEvents.visibility, 'team'))
      .returning({ id: rawEvents.id });
    expect((await scope.read()).sources).toMatchObject([{ key: 'web', total: 1, indexed: 0 }]);
    expect(await scope.indexJobs('source', 'web')).toMatchObject([
      { scope: 'raw_event', rawEventId: reopened?.id },
    ]);
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
    await db.insert(entities).values({
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
    // A second history-style presentation for the same `now` must reuse the
    // cached match scan instead of paginating objects again.
    const historyScope = withTeam(db, TEAM, OWNER);
    const listSpy = vi.spyOn(historyScope.objects, 'listObjects');
    const firstPass = await historyScope.savedViews.visibleDigestChanges(
      result,
      firstWindow,
      firstWindow,
    );
    const callsAfterFirst = listSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const secondPass = await historyScope.savedViews.visibleDigestChanges(
      result,
      firstWindow,
      firstWindow,
    );
    expect(secondPass).toEqual(firstPass);
    expect(listSpy.mock.calls.length).toBe(callsAfterFirst);
    listSpy.mockRestore();
    await db.update(entities).set({ status: 'done' }).where(eq(entities.id, added.id));
    // Fresh scope so the request cache does not retain the pre-update matches.
    expect(
      await withTeam(db, TEAM, OWNER).savedViews.visibleDigestChanges(
        result,
        firstWindow,
        firstWindow,
      ),
    ).toEqual([]);
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
    function fixtureResponse(input: Parameters<typeof fetch>[0]) {
      const url = new URL(input instanceof Request ? input.url : input);
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
    }
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => Promise.resolve(fixtureResponse(input)));
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
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
      resetEnvForTests();
    }
  });
});
