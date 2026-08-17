import { type Db, dailyDigests, entities } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PGlite } from '@electric-sql/pglite';

import { generateDailyDigest } from '#src/messaging/digest.js';
import {
  addTeamDigestDestination,
  insertDefaultDigestDestination,
  listTeamDigestDestinations,
  listWorkspaceDigestTeamIds,
  removeTeamDigestDestination,
} from '#src/messaging/destinations.js';
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
    expect(added).toMatchObject({ id: expect.any(String) });
    const destinations = await listTeamDigestDestinations(db, TEAM_ID);
    expect(destinations.map((row) => row.kind).sort()).toEqual(['email_members', 'slack_channel']);
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([TEAM_ID]);
    if ('id' in added) {
      await expect(
        removeTeamDigestDestination({ db, teamId: TEAM_ID, destinationId: added.id }),
      ).resolves.toBe(true);
    }
    expect(await listWorkspaceDigestTeamIds(db)).toEqual([]);
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
