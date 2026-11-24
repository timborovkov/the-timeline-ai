import type { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  agentSuggestionItems,
  agentSuggestions,
  calendarEvents,
  dailyDigests,
  entities,
  messagePreferences,
  rawEvents,
  savedWorkViews,
  objectChanges,
  teamBillingAccounts,
  teams,
  users,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { BillingAdmissionError } from '#src/billing/errors.js';
import {
  addTeamDigestDestination,
  insertDefaultDigestDestination,
  listTeamDigestDestinations,
  listWorkspaceDigestTeamIds,
  removeTeamDigestDestination,
} from '#src/messaging/destinations.js';
import {
  generateDailyDigest,
  getDigestPreference,
  hasScheduledUpdateBillingHold,
  listDailyDigests,
  listDailyDigestRecipients,
} from '#src/messaging/digest.js';
import { presentSavedViewDigest } from '#src/messaging/saved-view-digest.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

let db: Db;
let testDb: ResettablePGliteTestDb;

async function seedWorkspace(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'team-a', 'Team A');

    INSERT INTO users (id, email, name)
    VALUES ('${USER_ID}', 'owner@test.local', 'Owner');

    INSERT INTO team_members (team_id, user_id, role, created_at)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner', '2020-01-01T00:00:00Z');

    INSERT INTO message_preferences (
      team_id,
      user_id,
      daily_digest_enabled,
      daily_digest_hour,
      timezone
    )
    VALUES ('${TEAM_ID}', '${USER_ID}', true, 12, 'UTC');
  `);
}

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(seedWorkspace);
  db = drizzle(testDb.pg) as unknown as Db;
}, 60_000);

beforeEach(async () => {
  await testDb.reset();
});

afterAll(async () => {
  await testDb.close();
});

describe('daily digest terminal object activity', () => {
  it('generates when a freshly archived object is the only useful content', async () => {
    await db.insert(entities).values({
      id: '22222222-2222-2222-2222-222222222222',
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'Archived launch task',
      archivedAt: new Date('2026-07-27T11:30:00Z'),
      createdAt: new Date('2026-07-20T09:00:00Z'),
      updatedAt: new Date('2026-07-27T11:30:00Z'),
    });
    const summarize = vi.fn().mockResolvedValue('The launch task was archived.');

    await expect(
      generateDailyDigest({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        windowStart: new Date('2026-07-26T11:00:00Z'),
        windowEnd: new Date('2026-07-27T12:00:00Z'),
        now: new Date('2026-07-27T12:05:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      skipped: false,
      payload: {
        summary: 'The launch task was archived.',
        eventCount: 0,
        objectChangesByType: { task: 1 },
      },
    });
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('generates when a freshly merged object is the only useful content', async () => {
    await db.insert(entities).values([
      {
        id: '22222222-2222-2222-2222-222222222222',
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Surviving launch task',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        updatedAt: new Date('2026-07-20T09:00:00Z'),
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        teamId: TEAM_ID,
        type: 'task',
        canonicalName: 'Merged launch task',
        mergedIntoId: '22222222-2222-2222-2222-222222222222',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        updatedAt: new Date('2026-07-27T11:30:00Z'),
      },
    ]);
    const summarize = vi.fn().mockResolvedValue('The launch tasks were merged.');

    await expect(
      generateDailyDigest({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        windowStart: new Date('2026-07-26T11:00:00Z'),
        windowEnd: new Date('2026-07-27T12:00:00Z'),
        now: new Date('2026-07-27T12:05:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      skipped: false,
      payload: {
        summary: 'The launch tasks were merged.',
        eventCount: 0,
        objectChangesByType: { task: 1 },
      },
    });
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('counts every created task and only still-completed status changes', async () => {
    const createdAt = new Date('2026-07-27T10:00:00Z');
    const doneId = '44444444-4444-4444-4444-444444444444';
    const reopenedId = '55555555-5555-5555-5555-555555555555';
    const suggestionId = '66666666-6666-6666-6666-666666666666';
    await db.insert(entities).values([
      ...Array.from({ length: 15 }, (_, index) => ({
        id: `22222222-2222-2222-2222-2222222222${String(index).padStart(2, '0')}`,
        teamId: TEAM_ID,
        type: 'task' as const,
        canonicalName: `New launch task ${String(index)}`,
        status: 'todo',
        createdAt,
        updatedAt: createdAt,
      })),
      {
        id: doneId,
        teamId: TEAM_ID,
        type: 'task' as const,
        canonicalName: 'Finished launch recap',
        status: 'done',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        updatedAt: new Date('2026-07-27T11:00:00Z'),
      },
      {
        id: reopenedId,
        teamId: TEAM_ID,
        type: 'task' as const,
        canonicalName: 'Reopened launch recap',
        status: 'todo',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        updatedAt: new Date('2026-07-27T11:45:00Z'),
      },
    ]);
    await db.insert(objectChanges).values([
      {
        teamId: TEAM_ID,
        entityId: doneId,
        actorKind: 'user',
        status: 'applied',
        field: 'status',
        previousValue: 'todo',
        newValue: 'done',
        changedAt: new Date('2026-07-27T11:00:00Z'),
      },
      {
        teamId: TEAM_ID,
        entityId: reopenedId,
        actorKind: 'user',
        status: 'applied',
        field: 'status',
        previousValue: 'todo',
        newValue: 'done',
        changedAt: new Date('2026-07-27T11:30:00Z'),
      },
    ]);
    await db.insert(agentSuggestions).values({
      id: suggestionId,
      teamId: TEAM_ID,
      source: 'background',
      status: 'pending',
      title: 'Create follow-up task',
      dedupeKey: 'digest-new-proposal',
      visibility: 'team',
      createdAt: new Date('2026-07-27T10:30:00Z'),
      updatedAt: new Date('2026-07-27T10:30:00Z'),
    });
    await db.insert(agentSuggestionItems).values({
      suggestionId,
      teamId: TEAM_ID,
      status: 'pending',
      operation: 'create',
      targetKind: 'task',
      title: 'Create follow-up task',
      dedupeKey: 'item-1',
      proposedPayload: { canonicalName: 'Follow up' },
      createdAt: new Date('2026-07-27T10:30:00Z'),
      updatedAt: new Date('2026-07-27T10:30:00Z'),
    });
    const summarize = vi.fn().mockResolvedValue('Launch tasks moved and one recap closed.');

    const result = await generateDailyDigest({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      windowStart: new Date('2026-07-26T11:00:00Z'),
      windowEnd: new Date('2026-07-27T12:00:00Z'),
      now: new Date('2026-07-27T12:05:00Z'),
      summarize,
    });

    expect(result.skipped).toBe(false);
    expect(result.payload.activity).toMatchObject({
      newTasks: 15,
      completedTasks: 1,
      newProposals: 1,
      newObjectsByType: { task: 15 },
    });
    expect(result.payload.tasks).toHaveLength(12);
    expect(result.payload.completedTasks).toEqual([
      expect.objectContaining({ id: doneId, title: 'Finished launch recap', status: 'done' }),
    ]);
    expect(summarize).toHaveBeenCalledOnce();
  });
});

describe('workspace digest destinations', () => {
  it('persists default email and shared chat destinations', async () => {
    await insertDefaultDigestDestination(db, TEAM_ID);
    await insertDefaultDigestDestination(db, TEAM_ID);
    const added = await addTeamDigestDestination({
      db,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      destination: { kind: 'slack_channel', targetId: 'C123', label: '#general' },
    });
    if ('error' in added) throw new Error(added.error);
    expect(typeof added.id).toBe('string');
    const destinations = await listTeamDigestDestinations(db, TEAM_ID);
    expect(destinations.map((row) => row.kind).sort()).toEqual(['email_members', 'slack_channel']);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([TEAM_ID]);
    await expect(
      removeTeamDigestDestination({ db, teamId: TEAM_ID, destinationId: added.id }),
    ).resolves.toBe(true);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([]);
  });

  it('omits suspended workspaces and users from digest scheduling', async () => {
    const added = await addTeamDigestDestination({
      db,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      destination: { kind: 'slack_channel', targetId: 'C123', label: '#general' },
    });
    if ('error' in added) throw new Error(added.error);
    expect(await listDailyDigestRecipients(db)).toEqual([
      expect.objectContaining({ teamId: TEAM_ID, userId: USER_ID, email: 'owner@test.local' }),
    ]);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([TEAM_ID]);

    await db.insert(teamBillingAccounts).values({ teamId: TEAM_ID, securityState: 'suspended' });
    expect(await listDailyDigestRecipients(db)).toEqual([]);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([]);

    await db
      .update(teamBillingAccounts)
      .set({ securityState: 'terminated' })
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(await listDailyDigestRecipients(db)).toEqual([]);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([]);

    await db
      .update(teamBillingAccounts)
      .set({ securityState: 'normal' })
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, TEAM_ID));
    expect(await listDailyDigestRecipients(db)).toEqual([]);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([]);
    await db.update(teams).set({ disabledAt: null }).where(eq(teams.id, TEAM_ID));
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER_ID));
    expect(await listDailyDigestRecipients(db)).toEqual([]);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([TEAM_ID]);
  });

  it('generates a workspace digest without persisting a member row', async () => {
    await db.insert(entities).values({
      id: '44444444-4444-4444-4444-444444444444',
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'Archived launch task',
      archivedAt: new Date('2026-07-27T11:30:00Z'),
      createdAt: new Date('2026-07-20T09:00:00Z'),
      updatedAt: new Date('2026-07-27T11:30:00Z'),
    });
    const summarize = vi.fn().mockResolvedValue('The launch task was archived.');
    await expect(
      generateDailyDigest({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        audience: 'workspace',
        windowStart: new Date('2026-07-26T11:00:00Z'),
        windowEnd: new Date('2026-07-27T12:00:00Z'),
        now: new Date('2026-07-27T12:05:00Z'),
        summarize,
      }),
    ).resolves.toMatchObject({
      digestId: '',
      skipped: false,
      payload: { summary: 'The launch task was archived.', userName: null },
    });
    const rows = await db.select({ id: dailyDigests.id }).from(dailyDigests);
    expect(rows).toEqual([]);
  });
});

describe('configured scheduled updates', () => {
  const otherUser = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const otherTeam = '22222222-2222-2222-2222-222222222222';
  const evidenceId = '33333333-3333-3333-3333-333333333333';
  const window = {
    windowStart: new Date('2026-07-20T12:00:00Z'),
    windowEnd: new Date('2026-07-27T12:00:00Z'),
    now: new Date('2026-07-28T12:00:00Z'),
  };

  it('builds a weekly briefing from visible fresh sources, then hides it upon revocation', async () => {
    await testDb.pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES ('${otherTeam}', 'team-b', 'Team B');
      INSERT INTO users (id, email) VALUES ('${otherUser}', 'other@test.local');
      INSERT INTO team_members (team_id, user_id) VALUES ('${TEAM_ID}', '${otherUser}');
    `);
    await db.update(messagePreferences).set({
      updateOptions: {
        cadence: 'weekly',
        scope: 'workspace',
        focus: 'decisions',
        destination: 'app',
      },
      updatedAt: new Date('2026-07-18T00:00:00Z'),
    });
    const time = new Date('2026-07-24T09:00:00Z');
    await db.insert(rawEvents).values([
      {
        id: evidenceId,
        teamId: TEAM_ID,
        source: 'web',
        contentText: 'The pilot moves to Friday.',
        visibility: 'specific_users',
        visibilityOwnerUserId: otherUser,
        visibilityUserIds: [USER_ID],
        occurredAt: time,
        createdAt: time,
      },
      {
        teamId: TEAM_ID,
        source: 'web',
        contentText: 'Unrelated private work',
        visibility: 'private',
        visibilityOwnerUserId: otherUser,
        occurredAt: time,
        createdAt: time,
      },
      {
        teamId: otherTeam,
        source: 'web',
        contentText: 'Another workspace',
        occurredAt: time,
        createdAt: time,
      },
      {
        teamId: TEAM_ID,
        source: 'web',
        contentText: 'Old backfilled work',
        occurredAt: new Date('2026-07-01T09:00:00Z'),
        createdAt: time,
      },
    ]);
    const blockedSummary = vi
      .fn()
      .mockRejectedValue(new BillingAdmissionError('spend_cap_reached'));
    await expect(
      generateDailyDigest({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        ...window,
        summarize: blockedSummary,
      }),
    ).rejects.toMatchObject({ code: 'spend_cap_reached' });
    const identity = { db, teamId: TEAM_ID, userId: USER_ID };
    const preference = await getDigestPreference(identity);
    expect(await listDailyDigests(identity)).toHaveLength(0);
    expect(await hasScheduledUpdateBillingHold({ ...identity, preference, now: window.now })).toBe(
      true,
    );
    const summarize = vi.fn().mockResolvedValue('The pilot moves to Friday.');
    const input = { db, teamId: TEAM_ID, userId: USER_ID, ...window, summarize };
    const generated = await generateDailyDigest(input);
    expect(generated.skipped).toBe(false);
    expect(await hasScheduledUpdateBillingHold({ ...identity, preference, now: window.now })).toBe(
      false,
    );
    expect(generated.payload.evidenceIds).toEqual([evidenceId]);
    expect(summarize.mock.calls[0]?.[0]).toContain('Lead with supported decisions');
    expect(summarize.mock.calls[0]?.[0]).not.toContain('Old backfilled work');
    expect((await generateDailyDigest(input)).digestId).toBe(generated.digestId);
    expect(summarize).toHaveBeenCalledOnce();

    const scope = withTeam(db, TEAM_ID, USER_ID);
    expect((await presentSavedViewDigest(scope, generated.payload)).hasVisibleChanges).toBe(true);
    await db.update(rawEvents).set({ visibilityUserIds: [] }).where(eq(rawEvents.id, evidenceId));
    const revoked = await presentSavedViewDigest(scope, generated.payload);
    expect(revoked.hasVisibleChanges).toBe(false);
    expect(revoked.payload.links).toEqual([]);
    expect(revoked.payload.summary).not.toContain('pilot');
  });

  it('uses a separate evidence allowance for late captures and excludes future or unsettled events before limiting', async () => {
    await db.update(messagePreferences).set({
      updateOptions: {
        cadence: 'weekly',
        scope: 'workspace',
        focus: 'progress',
        destination: 'app',
      },
      updatedAt: new Date('2026-07-18T00:00:00Z'),
    });
    const time = new Date('2026-07-24T09:00:00Z');
    const recentContent = 'The approved pilot opened for participants.';
    const lateContent = 'The earlier prototype passed the accuracy review.';
    await db.insert(rawEvents).values([
      ...Array.from({ length: 360 }, () => ({
        teamId: TEAM_ID,
        source: 'web' as const,
        contentText: 'Captured a future calendar event.',
        occurredAt: new Date('2026-07-29T09:00:00Z'),
        createdAt: time,
      })),
      ...Array.from({ length: 360 }, () => ({
        teamId: TEAM_ID,
        source: 'web' as const,
        contentText: 'Routine update from the pilot.',
        occurredAt: time,
        createdAt: time,
      })),
      {
        teamId: TEAM_ID,
        source: 'web',
        contentText: recentContent,
        occurredAt: new Date('2026-07-26T09:00:00Z'),
        createdAt: new Date('2026-07-26T09:00:00Z'),
      },
      {
        teamId: TEAM_ID,
        source: 'web',
        contentText: lateContent,
        occurredAt: new Date('2026-07-17T09:00:00Z'),
        createdAt: time,
      },
      {
        teamId: TEAM_ID,
        source: 'web',
        contentText: 'Captured after the scheduled boundary.',
        occurredAt: new Date('2026-07-26T09:30:00Z'),
        createdAt: new Date('2026-07-27T13:00:00Z'),
      },
    ]);
    const summarize = vi.fn().mockResolvedValue('The approved pilot opened.');
    const update = await generateDailyDigest({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ...window,
      summarize,
    });
    expect(update.skipped).toBe(false);
    const prompt: unknown = summarize.mock.calls[0]?.[0];
    expect(prompt).toContain(recentContent);
    expect(prompt).toContain(lateContent);
    expect(prompt).toContain('"capturedLate":true');
    expect(prompt).not.toContain('Captured a future calendar event.');
    expect(prompt).not.toContain('Captured after the scheduled boundary.');
  });

  it('keeps the workspace cursor open when a held briefing publishes saved-view matches', async () => {
    const identity = { db, teamId: TEAM_ID, userId: USER_ID };
    const scope = withTeam(db, TEAM_ID, USER_ID);
    const revision = new Date('2026-07-18T00:00:00Z');
    await db.update(messagePreferences).set({
      updateOptions: {
        cadence: 'weekly',
        scope: 'workspace',
        focus: 'balanced',
        destination: 'app',
      },
      updatedAt: revision,
    });
    const view = await scope.savedViews.create({
      collection: 'tasks',
      targetId: null,
      title: 'New tasks',
      filters: {},
    });
    if (!view) throw new Error('Could not create the test view');
    await db
      .update(savedWorkViews)
      .set({ notify: true, optedInAt: revision, evaluatedThrough: revision })
      .where(eq(savedWorkViews.id, view));
    const date = new Date('2026-07-24T09:00:00Z');
    await db.insert(entities).values({
      teamId: TEAM_ID,
      type: 'task',
      canonicalName: 'Pilot access',
      status: 'todo',
      createdAt: date,
      updatedAt: date,
    });
    const content = 'The team approved opening the pilot.';
    await db.insert(rawEvents).values({
      teamId: TEAM_ID,
      source: 'web',
      contentText: content,
      occurredAt: date,
      createdAt: date,
    });
    const blocked = await generateDailyDigest({
      ...identity,
      ...window,
      summarize: vi.fn().mockRejectedValue(new BillingAdmissionError('spend_cap_reached')),
    });
    expect(blocked.skipped).toBe(false);
    expect(blocked.payload).toMatchObject({ savedViewsOnly: true, workspaceSummaryOnHold: true });
    expect(blocked.payload.savedViewChanges).toHaveLength(1);
    const preference = await getDigestPreference(identity);
    expect(await hasScheduledUpdateBillingHold({ ...identity, preference, now: window.now })).toBe(
      true,
    );

    const summarize = vi.fn().mockResolvedValue(content);
    const now = new Date('2026-08-04T12:00:00Z');
    const recovered = await generateDailyDigest({
      ...identity,
      windowStart: window.windowEnd,
      windowEnd: new Date('2026-08-03T12:00:00Z'),
      now,
      summarize,
    });
    expect(recovered.skipped).toBe(false);
    expect(recovered.payload.summary).toBe(content);
    expect(summarize.mock.calls[0]?.[0]).toContain(content);
    expect(await hasScheduledUpdateBillingHold({ ...identity, preference, now })).toBe(false);
  });

  it('preserves the source date and timezone of an archived all-day calendar event', async () => {
    await db.insert(calendarEvents).values({
      id: evidenceId,
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      title: 'Helsinki workshop',
      startAt: new Date('2026-07-26T21:00:00Z'),
      endAt: new Date('2026-07-27T21:00:00Z'),
      allDay: true,
      timezone: 'Europe/Helsinki',
    });
    const identity = { db, teamId: TEAM_ID, userId: USER_ID };
    const digest = await generateDailyDigest({
      ...identity,
      windowStart: new Date('2026-07-26T12:00:00Z'),
      windowEnd: window.windowEnd,
      now: new Date('2026-07-27T12:05:00Z'),
      summarize: vi.fn().mockResolvedValue('The team held a workshop.'),
    });
    expect(digest.skipped).toBe(false);
    const [stored] = await listDailyDigests({ ...identity, id: digest.digestId });
    expect(stored?.payload).toMatchObject({
      timezone: 'UTC',
      windowCalendar: [
        {
          title: 'Helsinki workshop',
          startAt: '2026-07-26T21:00:00.000Z',
          allDay: true,
          eventTimezone: 'Europe/Helsinki',
          href: `/app/calendar?view=day&date=2026-07-27&event=${evidenceId}`,
        },
      ],
    });
  });

  it('skips queued work while paused and keeps a completed quiet window suppressed on retry', async () => {
    await db.update(messagePreferences).set({
      dailyDigestEnabled: false,
      updateOptions: {
        cadence: 'weekly',
        scope: 'workspace',
        focus: 'balanced',
        destination: 'app',
      },
      updatedAt: new Date('2026-07-18T00:00:00Z'),
    });
    const summarize = vi.fn();
    const input = { db, teamId: TEAM_ID, userId: USER_ID, ...window, summarize };
    expect((await generateDailyDigest(input)).digestId).toBe('');
    await db.update(messagePreferences).set({ dailyDigestEnabled: true });
    const quiet = await generateDailyDigest(input);
    expect(quiet.skipped).toBe(true);
    expect(quiet.digestId).not.toBe('');
    expect((await generateDailyDigest(input)).digestId).toBe(quiet.digestId);
    expect(summarize).not.toHaveBeenCalled();
  });
});
