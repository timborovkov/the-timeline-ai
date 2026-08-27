import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, type Db } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWithBillingContext } from '#src/billing/context.js';
import {
  accrueTeamMemberDays,
  creditWalletFromPolarOrder,
  meterAcceptedSources,
  meterEmailUnits,
  resetIncludedDiscountIfPeriodElapsed,
  runWorkerBilling,
  withAiMetering,
} from '#src/billing/runtime.js';
import { createBillingScope } from '#src/billing/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'billing-runtime', 'Billing Runtime');
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

describe('billing runtime', () => {
  it('no-ops AI metering without ALS and settles when context is set', async () => {
    const unmetered = await withAiMetering({ operationClass: 'embedding' }, () =>
      Promise.resolve({
        value: 7,
        finish: { usage: { cost: 0 } },
      }),
    );
    expect(unmetered).toBe(7);

    const scoped = await runWorkerBilling(db, TEAM_ID, 'embedding', () =>
      withAiMetering({ operationClass: 'embedding' }, () =>
        Promise.resolve({
          value: 9,
          finish: { usage: { cost: 0 } },
        }),
      ),
    );
    expect(scoped).toBe(9);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.ai).toBeDefined();
  });

  it('meters email units idempotently', async () => {
    const first = await meterEmailUnits({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      operationId: 'email_in:msg-1',
      units: 2,
      operationClass: 'email_inbound',
    });
    expect(first.ok).toBe(true);
    const second = await meterEmailUnits({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      operationId: 'email_in:msg-1',
      units: 2,
      operationClass: 'email_inbound',
    });
    expect(second.ok).toBe(true);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.email_units?.nativeUnits).toBe(2);
  });

  it('settles accepted sources on the cumulative cent boundary', async () => {
    const ids = Array.from(
      { length: 10 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const result = await meterAcceptedSources({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      rawEventIds: ids,
    });
    expect(result.ok).toBe(true);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.accepted_sources?.nativeUnits).toBe(10);
    expect(dash.meters.accepted_sources?.customerChargeCents).toBe(1);
  });

  it('credits a Polar top-up once per order id', async () => {
    const first = await creditWalletFromPolarOrder({
      db,
      teamId: TEAM_ID,
      orderId: 'ord_1',
      cents: 1000,
    });
    expect(first.duplicate).toBe(false);
    const second = await creditWalletFromPolarOrder({
      db,
      teamId: TEAM_ID,
      orderId: 'ord_1',
      cents: 1000,
    });
    expect(second.duplicate).toBe(true);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.account.walletBalanceCents).toBe(1000);
  });

  it('accrues extra member-days on paid plans and resets included discount', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', included_discount_remaining_cents = 0,
          period_started_at = '2020-01-01T00:00:00Z', period_ends_at = '2020-02-01T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member');
    `);
    const reset = await resetIncludedDiscountIfPeriodElapsed({ db, teamId: TEAM_ID });
    expect(reset).toBe(true);
    const afterReset = await billing.getAccount();
    expect(afterReset.includedDiscountRemainingCents).toBe(6_000);

    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-22' });
    expect(accrued.extraMembers).toBe(0);
    const dash = await billing.getDashboard();
    expect(dash.activeMemberCount).toBe(3);
    expect(dash.planPreview.recommended).toBe('payg');
  });

  it('accrues a member added after the first daily settlement', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test'),
        ('41111111-2222-4333-8444-555555555555', 'm4@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '41111111-2222-4333-8444-555555555555', 'member');
    `);
    const first = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-26' });
    expect(first.extraMembers).toBe(1);
    expect(first.chargeCents).toBeGreaterThan(0);
    await pg.exec(`
      INSERT INTO users (id, email)
      VALUES ('51111111-2222-4333-8444-555555555555', 'm5@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '51111111-2222-4333-8444-555555555555', 'member');
    `);
    const second = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-26' });
    expect(second.extraMembers).toBe(2);
    expect(second.chargeCents).toBeGreaterThan(0);
    const third = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-26' });
    expect(third.extraMembers).toBe(2);
    expect(third.chargeCents).toBe(0);
  });

  it('persists extra member-day charges when wallet admission is denied', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 0,
          spend_cap_cents = 2500, shadow_billing = false
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test'),
        ('41111111-2222-4333-8444-555555555555', 'm4@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '41111111-2222-4333-8444-555555555555', 'member');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-27' });
    expect(accrued.extraMembers).toBe(1);
    expect(accrued.chargeCents).toBeGreaterThan(0);
    const after = await billing.getAccount();
    expect(after.billingState).toBe('read_only');
    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(ledger.some((row) => row.operationId.includes('member_days:'))).toBe(true);
  });

  it('skips AI metering when the caller already reserved the meter', async () => {
    const value = await runWithBillingContext(
      {
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        operationClass: 'agent_ask',
        skipMeters: new Set(['ai']),
      },
      () =>
        withAiMetering({ operationClass: 'agent_ask' }, () =>
          Promise.resolve({
            value: 1,
            finish: { usage: { cost: 1 } },
          }),
        ),
    );
    expect(value).toBe(1);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.ai).toBeUndefined();
  });

  it('preserves the Polar renewal boundary when the janitor refills included discount', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', included_discount_remaining_cents = 0,
          period_started_at = '2026-07-15T00:00:00Z', period_ends_at = '2026-08-15T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const reset = await resetIncludedDiscountIfPeriodElapsed({
      db,
      teamId: TEAM_ID,
      now: new Date('2026-08-20T12:00:00Z'),
    });
    expect(reset).toBe(true);
    const after = await billing.getAccount();
    expect(after.includedDiscountRemainingCents).toBe(6_000);
    expect(after.periodStartedAt?.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(after.periodEndsAt?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('does not overwrite a newer Polar plan or period already on the locked row', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'business', billing_state = 'business_active',
          included_discount_remaining_cents = 25000,
          period_started_at = '2026-08-20T00:00:00Z', period_ends_at = '2026-09-20T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const reset = await resetIncludedDiscountIfPeriodElapsed({
      db,
      teamId: TEAM_ID,
      now: new Date('2026-08-26T12:00:00Z'),
    });
    expect(reset).toBe(false);
    const after = await billing.getAccount();
    expect(after.planId).toBe('business');
    expect(after.includedDiscountRemainingCents).toBe(25_000);
    expect(after.periodStartedAt?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(after.periodEndsAt?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
});
