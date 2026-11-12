import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import type { Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { discoverBoardQualificationRequests } from '#src/workers/boardQualification-discovery.js';

it('keeps a large workspace backlog from hiding another workspace and skips inactive workspaces and removed members', async () => {
  const pg = new PGlite();
  const busyTeam = randomUUID();
  const otherTeam = randomUUID();
  const removedTeam = randomUUID();
  const user = randomUUID();
  try {
    await pg.exec(`
      CREATE TABLE teams (id uuid, disabled_at timestamptz, deletion_started_at timestamptz, deleted_at timestamptz);
      CREATE TABLE team_billing_accounts (team_id uuid, security_state text);
      INSERT INTO teams (id) VALUES ('${busyTeam}'), ('${otherTeam}'), ('${removedTeam}');
      CREATE TABLE team_members (team_id uuid, user_id uuid, removed_at timestamptz);
      CREATE TABLE board_qualification_requests (
        id uuid, team_id uuid, user_id uuid, version integer, available_at timestamptz, platform_operator_session_id uuid
      );
      INSERT INTO team_members VALUES
        ('${busyTeam}', '${user}', NULL), ('${otherTeam}', '${user}', NULL),
        ('${removedTeam}', '${user}', now());
      INSERT INTO board_qualification_requests
        SELECT gen_random_uuid(), '${busyTeam}'::uuid, '${user}'::uuid, 1, '2020-01-01'::timestamptz, '${user}'::uuid
        FROM generate_series(1, 50);
      INSERT INTO board_qualification_requests VALUES
        (gen_random_uuid(), '${otherTeam}', '${user}', 1, '2020-01-02', NULL),
        (gen_random_uuid(), '${removedTeam}', '${user}', 1, '2020-01-01', NULL),
        (gen_random_uuid(), '${otherTeam}', '${user}', 1, '2100-01-01', NULL);
    `);
    for (let index = 0; index < 12; index++) {
      const inactive = randomUUID();
      await pg.exec(`
        INSERT INTO teams (id, disabled_at) VALUES ('${inactive}', ${index < 6 ? 'now()' : 'NULL'});
        INSERT INTO team_members VALUES ('${inactive}', '${user}', NULL);
        INSERT INTO board_qualification_requests VALUES (gen_random_uuid(), '${inactive}', '${user}', 1, '2019-01-01', NULL);
        ${index >= 6 ? `INSERT INTO team_billing_accounts VALUES ('${inactive}', 'suspended');` : ''}
      `);
    }
    const requests = await discoverBoardQualificationRequests(
      drizzle(pg) as unknown as Db,
      new Date('2026-11-12'),
    );
    expect(requests[0]?.platformOperatorSessionId).toBe(user);
    expect(requests.map((request) => request.teamId)).toEqual([busyTeam, otherTeam]);
  } finally {
    await pg.close();
  }
});
