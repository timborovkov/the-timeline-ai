import { PGlite } from '@electric-sql/pglite';
import { billingOperatorAudit, teamBillingAccounts, type Db } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BillingOperatorError,
  assignCompedPlan,
  setTeamPriceOverride,
} from '#src/billing/operator-store.js';
import { resetEnvForTests } from '#src/env.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ADMIN_ID = '11111111-2222-4333-8444-555555555555';
const OWNER_ID = '22222222-3333-4444-8555-666666666666';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'tim-labs', 'Tim Labs');
    INSERT INTO users (id, email)
    VALUES
      ('${ADMIN_ID}', 'ops@example.test'),
      ('${OWNER_ID}', 'owner@example.test');
  `);
  db = drizzle(pg) as unknown as Db;
  process.env.PLATFORM_ADMIN_EMAILS = 'ops@example.test';
  resetEnvForTests();
});

afterEach(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetEnvForTests();
  await pg.close();
});

describe('billing operator store', () => {
  it('rejects a team owner who is not on the platform allowlist', async () => {
    await expect(
      assignCompedPlan({
        db,
        actor: { userId: OWNER_ID, email: 'owner@example.test' },
        teamId: TEAM_ID,
        entitlementsPlanId: 'team',
        spendCapCents: 2_500,
        reason: 'owner attempt',
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(BillingOperatorError);
  });

  it('records comp and price overrides with the previous and next values', async () => {
    await assignCompedPlan({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      entitlementsPlanId: 'team',
      spendCapCents: 2_500,
      reason: 'Tim internal',
      expiresAt: new Date('2026-12-31T23:59:59.999Z'),
    });
    await setTeamPriceOverride({
      db,
      actor: { userId: ADMIN_ID, email: 'ops@example.test' },
      teamId: TEAM_ID,
      override: { meteredDiscountPercent: 25, includedActiveMembers: 10 },
      expiresAt: null,
    });

    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.arrangement).toBe('comped');
    expect(account?.planId).toBe('team');
    expect(account?.spendCapCents).toBe(2_500);
    expect(account?.compReason).toBe('Tim internal');
    expect(account?.priceOverride).toEqual({
      meteredDiscountPercent: 25,
      includedActiveMembers: 10,
    });

    const audit = await db.select().from(billingOperatorAudit);
    expect(audit).toHaveLength(2);
    const comp = audit.find((row) => row.action === 'assign_comp');
    expect(comp?.actorEmail).toBe('ops@example.test');
    expect(comp?.before).toMatchObject({ arrangement: 'standard', planId: 'free' });
    expect(comp?.after).toMatchObject({
      arrangement: 'comped',
      planId: 'team',
      spendCapCents: 2_500,
    });
    const price = audit.find((row) => row.action === 'set_price_override');
    expect(price?.before).toMatchObject({ priceOverride: null });
    expect(price?.after).toMatchObject({
      priceOverride: { meteredDiscountPercent: 25, includedActiveMembers: 10 },
    });
  });
});
