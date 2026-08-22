import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyOwnedTeamFreeGrant,
  assertTeamCustomMcpCapacity,
  assertTeamMemberSeatCapacity,
  assertTeamWriteCapacity,
} from '#src/billing/capacity.js';
import { BillingAdmissionError } from '#src/billing/errors.js';
import { createBillingScope } from '#src/billing/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const EXTRA_TEAM_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'billing-capacity', 'Billing Capacity');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  await pg.close();
});

describe('billing capacity (not Polar meters)', () => {
  it('enforces Free document, member, and MCP stock limits', async () => {
    await pg.exec(`
      INSERT INTO documents (team_id, name)
      SELECT '${TEAM_ID}', 'doc-' || g FROM generate_series(1, 100) AS g;
    `);
    await expect(
      assertTeamWriteCapacity({ db, teamId: TEAM_ID, additionalDocuments: 1 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 2 });
    await expect(
      assertTeamMemberSeatCapacity({ db, teamId: TEAM_ID, additionalSeats: 3 }),
    ).rejects.toBeInstanceOf(BillingAdmissionError);

    await expect(assertTeamCustomMcpCapacity({ db, teamId: TEAM_ID })).rejects.toBeInstanceOf(
      BillingAdmissionError,
    );
  });

  it('does not mint a second Free grant for an extra owned workspace', async () => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${EXTRA_TEAM_ID}', 'extra-team', 'Extra Team');
    `);
    const first = await applyOwnedTeamFreeGrant({ db, teamId: TEAM_ID, userId: USER_ID });
    expect(first.ok).toBe(true);
    const extra = await applyOwnedTeamFreeGrant({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
    });
    expect(extra).toEqual({ ok: false, reason: 'free_grant_elsewhere' });
    const billing = createBillingScope({
      db,
      teamId: EXTRA_TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).billingState).toBe('restricted');
    const blocked = await billing.reserve({
      operationId: 'ask:web:extra',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(blocked.ok).toBe(false);
  });
});
