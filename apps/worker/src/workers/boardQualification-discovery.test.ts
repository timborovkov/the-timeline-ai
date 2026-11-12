import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { expect } from '@timeline/test-support';
import { it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '@timeline/db';

import { discoverBoardQualificationRequests } from '#src/workers/boardQualification-discovery.js';

it('keeps a large workspace backlog from hiding another workspace and skips removed members', async () => {
  const pg = new PGlite();
  const busyTeam = randomUUID();
  const otherTeam = randomUUID();
  const removedTeam = randomUUID();
  const user = randomUUID();
  try {
    await pg.exec(`
      CREATE TABLE team_members (team_id uuid, user_id uuid, removed_at timestamptz);
      CREATE TABLE board_qualification_requests (
        id uuid, team_id uuid, user_id uuid, version integer, available_at timestamptz
      );
      INSERT INTO team_members VALUES
        ('${busyTeam}', '${user}', NULL), ('${otherTeam}', '${user}', NULL),
        ('${removedTeam}', '${user}', now());
      INSERT INTO board_qualification_requests
        SELECT gen_random_uuid(), '${busyTeam}'::uuid, '${user}'::uuid, 1, '2020-01-01'::timestamptz
        FROM generate_series(1, 50);
      INSERT INTO board_qualification_requests VALUES
        (gen_random_uuid(), '${otherTeam}', '${user}', 1, '2020-01-02'),
        (gen_random_uuid(), '${removedTeam}', '${user}', 1, '2020-01-01'),
        (gen_random_uuid(), '${otherTeam}', '${user}', 1, '2100-01-01');
    `);
    const requests = await discoverBoardQualificationRequests(
      drizzle(pg) as unknown as Db,
      new Date('2026-11-12'),
    );
    expect(requests.map((request) => request.teamId)).toEqual([busyTeam, otherTeam]);
  } finally {
    await pg.close();
  }
});
