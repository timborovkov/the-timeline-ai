import { PGlite } from '@electric-sql/pglite';
import {
  billingMemberDayLedger,
  billingUsageLedger,
  billingUsageReservations,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWithBillingContext } from '#src/billing/context.js';
import {
  accrueTeamMemberDays,
  creditWalletFromPolarOrder,
  meterAcceptedSources,
  meterEmailUnits,
  resetIncludedDiscountIfPeriodElapsed,
  runWorkerBilling,
  snapshotTeamStorageGbMonth,
  utcDay,
  withAiMetering,
} from '#src/billing/runtime.js';
import * as billingScopeMod from '#src/billing/scope.js';
import { resetEnvForTests } from '#src/env.js';
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
  delete process.env.BILLING_CHARGES_ENABLED;
  resetEnvForTests();
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
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.ai).toBeDefined();
  });

  it('keeps the AI reservation when settle fails after the provider call', async () => {
    const originalCreate = billingScopeMod.createBillingScope;
    const settleError = new Error('settle failed after OpenRouter');
    const spy = vi.spyOn(billingScopeMod, 'createBillingScope').mockImplementation((deps) => {
      const scope = originalCreate(deps);
      return {
        ...scope,
        settle: () => Promise.reject(settleError),
      };
    });
    try {
      await expect(
        runWorkerBilling(
          db,
          TEAM_ID,
          'embedding',
          () =>
            withAiMetering({ operationClass: 'embedding' }, () =>
              Promise.resolve({
                value: 3,
                finish: { usage: { cost: 0.01 } },
              }),
            ),
          { operationId: 'embedding:job-durable' },
        ),
      ).rejects.toThrow('settle failed after OpenRouter');
      const [row] = await db
        .select()
        .from(billingUsageReservations)
        .where(eq(billingUsageReservations.teamId, TEAM_ID));
      expect(row?.state).toBe('reserved');
      expect(row?.operationId).toBe('embedding:job-durable');
    } finally {
      spy.mockRestore();
    }
  });

  it('skips the OpenRouter call when a durable AI operation already completed', async () => {
    const originalCreate = billingScopeMod.createBillingScope;
    const settleError = new Error('settle failed after OpenRouter');
    let settleCalls = 0;
    const spy = vi.spyOn(billingScopeMod, 'createBillingScope').mockImplementation((deps) => {
      const scope = originalCreate(deps);
      return {
        ...scope,
        settle: (...args: Parameters<typeof scope.settle>) => {
          settleCalls += 1;
          if (settleCalls === 1) return Promise.reject(settleError);
          return scope.settle(...args);
        },
      };
    });
    let providerCalls = 0;
    const run = () =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () =>
          withAiMetering({ operationClass: 'embedding' }, () => {
            providerCalls += 1;
            return Promise.resolve({
              value: { text: 'cached-embedding' },
              finish: { usage: { cost: 0.01 } },
            });
          }),
        { operationId: 'embedding:skip-provider' },
      );
    try {
      await expect(run()).rejects.toThrow('settle failed after OpenRouter');
      expect(providerCalls).toBe(1);
      const retried = await run();
      expect(retried).toEqual({ text: 'cached-embedding' });
      expect(providerCalls).toBe(1);
    } finally {
      spy.mockRestore();
    }
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
    const billing = billingScopeMod.createBillingScope({
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
    const billing = billingScopeMod.createBillingScope({
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
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.account.walletBalanceCents).toBe(1000);
  });

  it('accrues extra member-days on paid plans and resets included discount', async () => {
    const billing = billingScopeMod.createBillingScope({
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
    const billing = billingScopeMod.createBillingScope({
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
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
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

  it('backfills member-days missed between janitor snapshots', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const today = utcDay();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const twoDaysAgo = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 2),
      ),
    );
    const yesterday = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 1),
      ),
    );
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
      UPDATE team_members SET created_at = '${twoDaysAgo}T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_member_day_ledger (team_id, user_id, day, role, billable, charge_cents, plan_id)
      VALUES ('${TEAM_ID}', '${USER_ID}', '${twoDaysAgo}', 'owner', true, 0, 'payg');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    expect(accrued.extraMembers).toBe(0);
    const days = (
      await db
        .select({ day: billingMemberDayLedger.day })
        .from(billingMemberDayLedger)
        .where(eq(billingMemberDayLedger.teamId, TEAM_ID))
    ).map((row) => row.day);
    expect(days).toEqual(expect.arrayContaining([twoDaysAgo, yesterday, today]));
  });

  it('settles historical member-days with the plan stamped on that day', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const extraIds = [
      '21111111-2222-4333-8444-555555555555',
      '31111111-2222-4333-8444-555555555555',
      '41111111-2222-4333-8444-555555555555',
      '51111111-2222-4333-8444-555555555555',
      '61111111-2222-4333-8444-555555555555',
      '71111111-2222-4333-8444-555555555555',
      '81111111-2222-4333-8444-555555555555',
    ];
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', included_discount_remaining_cents = 0,
          wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ${extraIds.map((id, i) => `('${id}', 'm${i + 2}@example.test')`).join(',\n        ')};
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ${extraIds.map((id) => `('${TEAM_ID}', '${id}', 'member')`).join(',\n        ')};
    `);
    const teamDay = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-10' });
    expect(teamDay.extraMembers).toBe(0);
    const stamped = await db
      .select({ planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(stamped.every((row) => row.planId === 'team')).toBe(true);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
    `);
    const revisited = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-10' });
    expect(revisited.extraMembers).toBe(0);
    expect(revisited.chargeCents).toBe(0);
    const after = await db
      .select({ planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(after.every((row) => row.planId === 'team')).toBe(true);
  });

  it('backfills member-days from preserved prior membership intervals', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const today = utcDay();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const twoDaysAgo = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 2),
      ),
    );
    const yesterday = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 1),
      ),
    );
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
      UPDATE team_members
      SET created_at = '${today}T12:00:00Z',
          prior_intervals = '[{"startedAt":"${twoDaysAgo}T00:00:00.000Z","endedAt":"${yesterday}T12:00:00.000Z"}]'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    expect(accrued.extraMembers).toBe(0);
    const days = (
      await db
        .select({ day: billingMemberDayLedger.day })
        .from(billingMemberDayLedger)
        .where(eq(billingMemberDayLedger.teamId, TEAM_ID))
    ).map((row) => row.day);
    expect(days).toEqual(expect.arrayContaining([twoDaysAgo, yesterday, today]));
  });

  it('retries unsettled member-day facts after past_due recovery', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const extraUserId = '41111111-2222-4333-8444-555555555555';
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'past_due', wallet_balance_cents = 5000,
          spend_cap_cents = 2500, shadow_billing = false
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test'),
        ('${extraUserId}', 'm4@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '${extraUserId}', 'member');
    `);
    const denied = await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    expect(denied.chargeCents).toBe(0);
    const before = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(before.some((row) => row.operationId.includes('member_days:'))).toBe(false);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'payg_active'
      WHERE team_id = '${TEAM_ID}';
    `);
    const recovered = await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    expect(recovered.extraMembers).toBe(1);
    expect(recovered.chargeCents).toBeGreaterThan(0);
    const after = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(after.some((row) => row.operationId.includes(`member_days:${TEAM_ID}:`))).toBe(true);
  });

  it('does not bill gap days after a membership createdAt reset', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const today = utcDay();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const twoDaysAgo = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 2),
      ),
    );
    const yesterday = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 1),
      ),
    );
    const extraUserId = '41111111-2222-4333-8444-555555555555';
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
      UPDATE team_members SET created_at = '${twoDaysAgo}T00:00:00Z'
      WHERE team_id = '${TEAM_ID}' AND user_id = '${USER_ID}';
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test'),
        ('${extraUserId}', 'm4@example.test');
      INSERT INTO team_members (team_id, user_id, role, created_at) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member', '${today}T00:00:00Z'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member', '${today}T00:00:00Z'),
        ('${TEAM_ID}', '${extraUserId}', 'member', '${today}T00:00:00Z');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    expect(accrued.extraMembers).toBe(1);
    const extraOps = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    )
      .map((row) => row.operationId)
      .filter((id) => id.includes(extraUserId));
    expect(extraOps.some((id) => id.includes(`:${today}:`))).toBe(true);
    expect(extraOps.some((id) => id.includes(`:${yesterday}:`))).toBe(false);
  });

  it('backfills missed storage snapshot days', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const today = utcDay();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const twoDaysAgo = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 2),
      ),
    );
    const yesterday = utcDay(
      new Date(
        Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - 1),
      ),
    );
    await pg.exec(`
      INSERT INTO documents (id, team_id, name)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000001', '${TEAM_ID}', 'store.bin');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000002',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000001',
        1,
        'team/docs/store.bin',
        1073741824,
        '${twoDaysAgo}T00:00:00Z'
      );
    `);
    const result = await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID });
    expect(result.settled).toBe(true);
    const ops = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(ops).toEqual(
      expect.arrayContaining([
        `storage_gb:${TEAM_ID}:${twoDaysAgo}`,
        `storage_gb:${TEAM_ID}:${yesterday}`,
        `storage_gb:${TEAM_ID}:${today}`,
      ]),
    );
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
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.ai).toBeUndefined();
  });

  it('preserves the Polar renewal boundary when the janitor refills included discount', async () => {
    const billing = billingScopeMod.createBillingScope({
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
    const billing = billingScopeMod.createBillingScope({
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
