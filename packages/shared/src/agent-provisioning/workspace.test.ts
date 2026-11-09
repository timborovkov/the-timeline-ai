import {
  type Db,
  auditLog,
  teamBillingAccounts,
  teamCalendarSettings,
  teamDigestDestinations,
  teamMembers,
  teams,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  createOwnedWorkspace,
  initializeOwnedWorkspace,
} from '#src/agent-provisioning/workspace.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

// Signup initializes restricted billing; only the verified-owner workflow may claim Free.
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let fixture: ResettablePGliteTestDb;
let db: Db;
beforeAll(async () => {
  fixture = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(
      `INSERT INTO users (id,email,"emailVerified") VALUES ('${ownerId}','owner@example.test',now())`,
    );
  });
  db = drizzle(fixture.pg) as unknown as Db;
});
beforeEach(async () => {
  await fixture.reset();
});
afterAll(async () => {
  await fixture.close();
});

describe('workspace initialization policies', () => {
  it('keeps signup restricted and leaves calendar and audit setup to the owning workflow', async () => {
    const team = await db.transaction((tx) =>
      initializeOwnedWorkspace(tx, {
        ownerId,
        name: "Owner's Team",
        slug: 'owner-team-fixed',
        inboundEmail: 'owner-team-fixed@inbound.test',
      }),
    );
    expect(team?.slug).toBe('owner-team-fixed');
    expect(await db.select().from(teamMembers)).toEqual([
      expect.objectContaining({ teamId: team?.id, userId: ownerId, role: 'owner' }),
    ]);
    expect(await db.select().from(teamBillingAccounts)).toEqual([
      expect.objectContaining({ teamId: team?.id, billingState: 'restricted', planId: 'free' }),
    ]);
    expect(await db.select().from(teamCalendarSettings)).toEqual([]);
    expect(await db.select().from(auditLog)).toEqual([]);
    expect(await db.select().from(teamDigestDestinations)).toEqual([
      expect.objectContaining({ teamId: team?.id, kind: 'email_members', enabled: true }),
    ]);
  });

  it('keeps deliberate workspace creation timezone, audit and verified Free grant', async () => {
    const result = await db.transaction((tx) =>
      createOwnedWorkspace(tx, { ownerId, name: 'Created workspace', timezone: 'Europe/London' }),
    );
    expect(result.billing).toEqual({ restricted: false });
    expect(await db.select().from(teamCalendarSettings)).toEqual([
      expect.objectContaining({ teamId: result.team.id, defaultTimezone: 'Europe/London' }),
    ]);
    expect(await db.select().from(auditLog)).toContainEqual(
      expect.objectContaining({
        teamId: result.team.id,
        action: 'workspace.create',
        actorUserId: ownerId,
      }),
    );
  });

  it('rolls back owner membership and defaults with the workspace transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        await initializeOwnedWorkspace(tx, {
          ownerId,
          name: 'Rollback',
          slug: 'rollback',
          inboundEmail: 'rollback@inbound.test',
        });
        throw new Error('signup aborted');
      }),
    ).rejects.toThrow('signup aborted');
    expect(await db.select().from(teams)).toEqual([]);
    expect(await db.select().from(teamMembers)).toEqual([]);
    expect(await db.select().from(teamBillingAccounts)).toEqual([]);
  });
});
