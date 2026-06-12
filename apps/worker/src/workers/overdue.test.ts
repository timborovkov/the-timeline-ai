import { PGlite } from '@electric-sql/pglite';
import { type Db, entities, notifications } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import { processOverdueScanTick } from '#src/workers/overdue.js';

/**
 * Real-DB integration tests for the overdue scan. The contract is persisted
 * behavior: one notification per overdue task/follow-up recipient, no noise for
 * done/cancelled/suggested/archived rows, and database-level same-day dedupe.
 */

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-2222-2222-222222222222';
const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let pg: PGlite;
let db: Db;

async function seedTeams(): Promise<void> {
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_A}', 'team-a', 'Team A'),
      ('${TEAM_B}', 'team-b', 'Team B');

    INSERT INTO users (id, email)
    VALUES
      ('${OWNER_A}', 'owner-a@test.local'),
      ('${MEMBER_A}', 'member-a@test.local'),
      ('${OWNER_B}', 'owner-b@test.local');

    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_A}', '${OWNER_A}', 'owner'),
      ('${TEAM_A}', '${MEMBER_A}', 'member'),
      ('${TEAM_B}', '${OWNER_B}', 'owner');
  `);
}

async function insertObject(input: {
  id: string;
  teamId?: string;
  type?: 'task' | 'follow_up' | 'project';
  name: string;
  status?: string;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  archived?: boolean;
  mergedIntoId?: string | null;
}): Promise<void> {
  await db.insert(entities).values({
    id: input.id,
    teamId: input.teamId ?? TEAM_A,
    type: input.type ?? 'task',
    canonicalName: input.name,
    status: input.status ?? 'todo',
    ownerUserId: input.ownerUserId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    dueAt: input.dueAt ?? new Date('2024-01-01T12:00:00Z'),
    archivedAt: input.archived ? new Date('2024-01-02T12:00:00Z') : null,
    mergedIntoId: input.mergedIntoId ?? null,
  });
}

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await seedTeams();
});

afterEach(async () => {
  await pg.close();
});

describe('processOverdueScanTick', () => {
  it('creates one overdue notification per distinct owner and assignee', async () => {
    const taskId = '00000000-0000-0000-0000-000000000101';
    await insertObject({
      id: taskId,
      name: 'Finish migration',
      ownerUserId: OWNER_A,
      assigneeUserId: MEMBER_A,
    });

    const result = await processOverdueScanTick({ db }, 'test-job');

    expect(result).toEqual({ scanned: 1, inserted: 2 });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, taskId))
      .orderBy(notifications.userId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.userId)).toEqual([OWNER_A, MEMBER_A]);
    expect(rows.map((row) => row.kind)).toEqual(['task_overdue', 'task_overdue']);
    expect(rows.every((row) => row.teamId === TEAM_A)).toBe(true);
  });

  it('dedupes same-recipient owner/assignee and suppresses repeat scans on the same day', async () => {
    const taskId = '00000000-0000-0000-0000-000000000102';
    await insertObject({
      id: taskId,
      name: 'Same owner and assignee',
      ownerUserId: OWNER_A,
      assigneeUserId: OWNER_A,
    });

    await expect(processOverdueScanTick({ db }, 'first')).resolves.toEqual({
      scanned: 1,
      inserted: 1,
    });
    await expect(processOverdueScanTick({ db }, 'second')).resolves.toEqual({
      scanned: 1,
      inserted: 0,
    });

    const rows = await db.select().from(notifications).where(eq(notifications.entityId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(OWNER_A);
  });

  it('skips non-actionable or non-recipient rows while still scanning eligible candidates', async () => {
    await insertObject({
      id: '00000000-0000-0000-0000-000000000201',
      name: 'Done task',
      status: 'done',
      ownerUserId: OWNER_A,
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000202',
      name: 'Cancelled task',
      status: 'cancelled',
      ownerUserId: OWNER_A,
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000203',
      name: 'Suggested task',
      status: 'suggested',
      ownerUserId: OWNER_A,
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000204',
      name: 'Archived task',
      ownerUserId: OWNER_A,
      archived: true,
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000205',
      name: 'Future task',
      ownerUserId: OWNER_A,
      dueAt: new Date('2999-01-01T12:00:00Z'),
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000206',
      name: 'No recipient task',
    });
    await insertObject({
      id: '00000000-0000-0000-0000-000000000207',
      type: 'project',
      name: 'Overdue project is not actionable',
      ownerUserId: OWNER_A,
    });

    const result = await processOverdueScanTick({ db }, 'skip-job');

    expect(result).toEqual({ scanned: 1, inserted: 0 });
    await expect(db.select().from(notifications)).resolves.toEqual([]);
  });

  it('preserves each source team when scanning all teams globally', async () => {
    const teamATaskId = '00000000-0000-0000-0000-000000000301';
    const teamBFollowUpId = '00000000-0000-0000-0000-000000000302';
    await insertObject({
      id: teamATaskId,
      name: 'Team A task',
      ownerUserId: OWNER_A,
    });
    await insertObject({
      id: teamBFollowUpId,
      teamId: TEAM_B,
      type: 'follow_up',
      name: 'Team B follow-up',
      ownerUserId: OWNER_B,
    });

    const result = await processOverdueScanTick({ db }, 'global-job');

    expect(result).toEqual({ scanned: 2, inserted: 2 });
    const rows = await db.select().from(notifications).orderBy(notifications.teamId);
    expect(rows).toEqual([
      expect.objectContaining({
        teamId: TEAM_A,
        userId: OWNER_A,
        entityId: teamATaskId,
        kind: 'task_overdue',
      }),
      expect.objectContaining({
        teamId: TEAM_B,
        userId: OWNER_B,
        entityId: teamBFollowUpId,
        kind: 'follow_up_overdue',
      }),
    ]);
  });
});
