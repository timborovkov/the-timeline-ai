import { PGlite } from '@electric-sql/pglite';
import {
  billingMemberDayLedger,
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reserveAskAi } from '#src/billing/admission.js';
import { scopedAiOperationId } from '#src/billing/ai-call.js';
import {
  daysInPeriodYm,
  memberDayChargeDelta,
  periodYmUtc,
  polarMemberMonthUnits,
} from '#src/billing/charge.js';
import { runWithBillingContext } from '#src/billing/context.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import {
  accrueTeamMemberDays,
  meterAcceptedSources,
  meterEmailUnits,
  periodYm,
  resetIncludedDiscountIfPeriodElapsed,
  runWorkerBilling,
  settlePendingBillingReservations,
  snapshotTeamStorageGbMonth,
  utcDay,
  withAiMetering,
} from '#src/billing/runtime.js';
import * as billingScopeMod from '#src/billing/scope.js';
import { resetEnvForTests } from '#src/env.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

function utcDayOffset(days: number): string {
  const date = new Date(`${utcDay()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

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
            withAiMetering({ operationClass: 'embedding', callMaterial: ['durable-call'] }, () =>
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
      expect(row?.operationId).toBe(
        scopedAiOperationId({
          parentOperationId: 'embedding:job-durable',
          stage: 'embedding',
          material: ['durable-call'],
        }),
      );
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
          withAiMetering({ operationClass: 'embedding', callMaterial: ['skip-provider'] }, () => {
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

  it('charges members past a custom included count at the custom extra-member price', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const previousPolarToken = process.env.POLAR_ACCESS_TOKEN;
    process.env.BILLING_CHARGES_ENABLED = 'true';
    delete process.env.POLAR_ACCESS_TOKEN;
    resetEnvForTests();
    try {
      await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', shadow_billing = false,
          wallet_balance_cents = 5000, spend_cap_cents = 2500,
          polar_customer_id = 'cus_custom_members',
          price_override = '{"includedActiveMembers":1,"additionalMemberCents":400}'::jsonb
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email)
      VALUES ('21111111-2222-4333-8444-555555555555', 'm2@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member');
    `);
      const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-10-02' });
      const expected = memberDayChargeDelta({
        previousNativeUnits: 0,
        nextNativeUnits: 1,
        centsPerMemberMonth: 400,
        daysInMonth: daysInPeriodYm(periodYmUtc()),
      });
      expect(accrued.extraMembers).toBe(1);
      expect(accrued.chargeCents).toBe(expected);
      const ledger = await db
        .select()
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID));
      const row = ledger.find((entry) => entry.operationId.includes('member_days:'));
      expect(row?.customerChargeCents).toBe(expected);
      expect(row?.metadata).toMatchObject({
        polar_ingest_name: 'timeline_extra_member_days',
        polar_ingest_units: polarMemberMonthUnits(expected),
        polar_ingest_status: 'pending',
      });
    } finally {
      if (previousPolarToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
      else process.env.POLAR_ACCESS_TOKEN = previousPolarToken;
      resetEnvForTests();
    }
  });

  it('does not bill extra members when Enterprise included members are unlimited', async () => {
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
      SET plan_id = 'enterprise', billing_state = 'enterprise_active', shadow_billing = false,
          spend_cap_cents = 0,
          price_override = '{"additionalMemberCents":500}'::jsonb
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email)
      VALUES ('21111111-2222-4333-8444-555555555555', 'm2@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-10-02' });
    expect(accrued.extraMembers).toBe(0);
    expect(accrued.chargeCents).toBe(0);
  });

  it('persists extra member-day charges when the spend cap is already exhausted', async () => {
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
          spend_cap_cents = 0, shadow_billing = false
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'payg', clock_timestamp() + INTERVAL '1 millisecond');
      INSERT INTO users (id, email) VALUES
        ('21111111-2222-4333-8444-555555555555', 'm2@example.test'),
        ('31111111-2222-4333-8444-555555555555', 'm3@example.test'),
        ('41111111-2222-4333-8444-555555555555', 'm4@example.test');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_ID}', '21111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '31111111-2222-4333-8444-555555555555', 'member'),
        ('${TEAM_ID}', '41111111-2222-4333-8444-555555555555', 'member');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: utcDay() });
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

  it('bills unsettled member-days at the paid plan rate after a move to Enterprise', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const day = '2026-02-10';
    const extraIds = [
      '21111111-2222-4333-8444-555555555555',
      '31111111-2222-4333-8444-555555555555',
      '41111111-2222-4333-8444-555555555555',
    ];
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'past_due', shadow_billing = false,
          spend_cap_cents = 2500
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ${extraIds.map((id, i) => `('${id}', 'extra${i + 2}@example.test')`).join(',\n        ')};
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ${extraIds.map((id) => `('${TEAM_ID}', '${id}', 'member')`).join(',\n        ')};
    `);
    const denied = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day });
    expect(denied.chargeCents).toBe(0);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active', price_override = NULL
      WHERE team_id = '${TEAM_ID}';
    `);
    const replayed = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day });
    const expected = memberDayChargeDelta({
      previousNativeUnits: 0,
      nextNativeUnits: 1,
      centsPerMemberMonth: 200,
      daysInMonth: daysInPeriodYm('2026-02'),
    });
    expect(replayed.extraMembers).toBe(1);
    expect(replayed.chargeCents).toBe(expected);
    expect(expected).toBe(7);
    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const row = ledger.find((entry) => entry.operationId.includes('member_days:'));
    expect(row?.customerChargeCents).toBe(expected);
  });

  it('prices a missed member-day from plan history before the current plan', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const day = '2026-08-10';
    const extraIds = [
      '21111111-2222-4333-8444-555555555555',
      '31111111-2222-4333-8444-555555555555',
      '41111111-2222-4333-8444-555555555555',
      '51111111-2222-4333-8444-555555555555',
      '61111111-2222-4333-8444-555555555555',
      '71111111-2222-4333-8444-555555555555',
      '81111111-2222-4333-8444-555555555555',
      '91111111-2222-4333-8444-555555555555',
      'a1111111-2222-4333-8444-555555555555',
    ];
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', shadow_billing = false,
          wallet_balance_cents = 5000, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at) VALUES
        ('${TEAM_ID}', 'team', '${day}T00:00:00Z'),
        ('${TEAM_ID}', 'payg', '2026-08-11T00:00:00Z');
      INSERT INTO users (id, email) VALUES
        ${extraIds.map((id, i) => `('${id}', 'seat${i + 2}@example.test')`).join(',\n        ')};
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ${extraIds.map((id) => `('${TEAM_ID}', '${id}', 'member')`).join(',\n        ')};
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day });
    expect(accrued.extraMembers).toBe(0);
    expect(accrued.chargeCents).toBe(0);
    const stamped = await db
      .select({ planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(stamped).toHaveLength(10);
    expect(stamped.every((row) => row.planId === 'team')).toBe(true);
    const ledger = await db
      .select({ operationId: billingUsageLedger.operationId })
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(ledger.some((row) => row.operationId.includes('member_days:'))).toBe(false);
    const [account] = await db
      .select({ wallet: teamBillingAccounts.walletBalanceCents })
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.wallet).toBe(5000);
  });

  it('prices member-days before comp expiry and Free after it', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const before = '2026-08-10';
    const after = '2026-08-20';
    const extraIds = Array.from({ length: 25 }, (_, index) => {
      const n = (index + 2).toString(16).padStart(8, '0');
      return `${n}-2222-4333-8444-555555555555`;
    });
    const paidDayCharge = memberDayChargeDelta({
      previousNativeUnits: 0,
      nextNativeUnits: 1,
      centsPerMemberMonth: 200,
      daysInMonth: daysInPeriodYm(before.slice(0, 7)),
    });
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', arrangement = 'comped',
          comp_expires_at = '2026-08-15T00:00:00Z', shadow_billing = false,
          included_discount_remaining_cents = 0, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'team', '2026-08-01T00:00:00Z');
      INSERT INTO users (id, email) VALUES
        ${extraIds.map((id, i) => `('${id}', 'comp${i + 2}@example.test')`).join(',\n        ')};
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ${extraIds.map((id) => `('${TEAM_ID}', '${id}', 'member')`).join(',\n        ')};
    `);
    const paid = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: before });
    expect(paid.extraMembers).toBe(1);
    expect(paid.chargeCents).toBe(paidDayCharge);
    const freeDay = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: after });
    expect(freeDay.extraMembers).toBe(0);
    expect(freeDay.chargeCents).toBe(0);
    const stamped = await db
      .select({ day: billingMemberDayLedger.day, planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(stamped.filter((row) => row.day === before).every((row) => row.planId === 'team')).toBe(
      true,
    );
    expect(stamped.filter((row) => row.day === after).every((row) => row.planId === 'free')).toBe(
      true,
    );
  });

  it('keeps a stamped member-day on its plan after the comp expires', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const day = '2026-08-20';
    const extraIds = Array.from({ length: 25 }, (_, index) => {
      const n = (index + 2).toString(16).padStart(8, '0');
      return `${n}-2222-4333-8444-555555555555`;
    });
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', arrangement = 'comped',
          comp_expires_at = '2026-08-15T00:00:00Z', shadow_billing = false,
          included_discount_remaining_cents = 0, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO users (id, email) VALUES
        ${extraIds.map((id, i) => `('${id}', 'stamp${i + 2}@example.test')`).join(',\n        ')};
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ${extraIds.map((id) => `('${TEAM_ID}', '${id}', 'member')`).join(',\n        ')};
      INSERT INTO billing_member_day_ledger (team_id, user_id, day, plan_id, role, billable)
      VALUES ('${TEAM_ID}', '${USER_ID}', '${day}', 'team', 'owner', true);
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day });
    expect(accrued.extraMembers).toBe(1);
    expect(accrued.chargeCents).toBeGreaterThan(0);
    const stamped = await db
      .select({ planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(stamped).toHaveLength(26);
    expect(stamped.every((row) => row.planId === 'team')).toBe(true);
  });

  it('keeps a contractual Enterprise day on Enterprise', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active', arrangement = 'standard',
          spend_cap_cents = 0
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'enterprise', '2026-08-01T00:00:00Z');
    `);
    const accrued = await accrueTeamMemberDays({ db, teamId: TEAM_ID, day: '2026-08-20' });
    expect(accrued.extraMembers).toBe(0);
    expect(accrued.chargeCents).toBe(0);
    const [stamped] = await db
      .select({ planId: billingMemberDayLedger.planId })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(stamped?.planId).toBe('enterprise');
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
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'payg', clock_timestamp() + INTERVAL '1 millisecond');
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
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'payg', clock_timestamp() + INTERVAL '1 millisecond');
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

  it('refills an expired comp from the Free allowance, not the stored plan', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', plan_id = 'team', billing_state = 'team_active',
          comp_reason = 'trial', comp_expires_at = '2020-01-01T00:00:00Z',
          included_discount_remaining_cents = 0,
          period_started_at = '2026-07-15T00:00:00Z', period_ends_at = '2026-08-15T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const reset = await resetIncludedDiscountIfPeriodElapsed({
      db,
      teamId: TEAM_ID,
      now: new Date('2026-08-20T12:00:00Z'),
    });
    expect(reset).toBe(true);
    expect((await billing.getAccount()).includedDiscountRemainingCents).toBe(0);
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

  it('replays storage and member-days from the previous calendar month', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const missed = utcDayOffset(-31);
    await pg.exec(`
      UPDATE team_members SET created_at = '${missed}T00:00:00Z'
      WHERE team_id = '${TEAM_ID}' AND user_id = '${USER_ID}';
      INSERT INTO documents (id, team_id, name)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000011', '${TEAM_ID}', 'old.bin');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000012',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000011',
        1,
        'team/docs/old.bin',
        1048576,
        '${missed}T00:00:00Z'
      );
    `);
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID });
    await accrueTeamMemberDays({ db, teamId: TEAM_ID });
    const storage = await db
      .select({ operationId: billingUsageLedger.operationId })
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(storage.map((row) => row.operationId)).toContain(`storage_gb:${TEAM_ID}:${missed}`);
    const [storageCounter] = await db
      .select()
      .from(billingUsageCounters)
      .where(
        and(
          eq(billingUsageCounters.teamId, TEAM_ID),
          eq(billingUsageCounters.meterId, 'storage_gb_month'),
          eq(billingUsageCounters.periodYm, missed.slice(0, 7)),
        ),
      );
    expect(Number(storageCounter?.nativeUnits ?? 0)).toBeGreaterThan(0);
    const memberDays = await db
      .select({ day: billingMemberDayLedger.day })
      .from(billingMemberDayLedger)
      .where(eq(billingMemberDayLedger.teamId, TEAM_ID));
    expect(memberDays.map((row) => row.day)).toContain(missed);
  });

  it('settles reported usage from a failed AI call and releases the work reservation', async () => {
    const operationId = 'embedding:failed-attempt';
    await expect(
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () =>
          withAiMetering({ operationClass: 'embedding', operationId }, () =>
            Promise.reject(Object.assign(new Error('bad json'), { openRouterUsd: 0.02 })),
          ),
        { operationId },
      ),
    ).rejects.toThrow('bad json');
    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const attempt = ledger.find((row) => row.operationId === `${operationId}:failed:1`);
    expect(attempt?.customerChargeCents).toBeGreaterThan(0);
    expect(attempt?.metadata).toMatchObject({
      failed_attempt_for: operationId,
      openrouter_usd: 0.02,
    });
    const [reservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(reservation?.state).toBe('released');
  });

  it('refuses a job operation id that has no per-call material', async () => {
    await expect(
      runWorkerBilling(
        db,
        TEAM_ID,
        'chat_structured',
        () =>
          withAiMetering({ operationClass: 'chat_structured' }, () =>
            Promise.resolve({
              value: { kind: 'extract' },
              finish: { usage: { cost: 0 } },
            }),
          ),
        { operationId: 'suggestions:job-shared' },
      ),
    ).rejects.toThrow(/callMaterial/);
  });

  it('does not replay one call in a job as the result of a different call', async () => {
    let calls = 0;
    const run = (material: string) =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'chat_structured',
        () =>
          withAiMetering(
            {
              operationClass: 'chat_structured',
              stage: 'chat_structured',
              callMaterial: [material],
            },
            () => {
              calls += 1;
              return Promise.resolve({
                value: { kind: material },
                finish: { usage: { cost: 0.01 } },
              });
            },
          ),
        { operationId: 'suggestions:job-shared' },
      );

    const extracted = await run('extract');
    const classified = await run('classify');
    const replayed = await run('extract');

    expect(extracted).toEqual({ kind: 'extract' });
    expect(classified).toEqual({ kind: 'classify' });
    expect(replayed).toEqual(extracted);
    expect(calls).toBe(2);
    const operationIds = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(operationIds).toHaveLength(2);
    expect(
      operationIds.every((operationId) =>
        operationId.startsWith('suggestions:job-shared:chat_structured:'),
      ),
    ).toBe(true);
    expect(new Set(operationIds).size).toBe(2);
  });

  it('calls the provider again for a different transcription chunk id', async () => {
    let calls = 0;
    await runWorkerBilling(
      db,
      TEAM_ID,
      'transcription',
      async () => {
        await withAiMetering(
          { operationClass: 'transcription', operationId: 'transcription:job-9:0' },
          () => {
            calls += 1;
            return Promise.resolve({ value: { text: 'a' }, finish: { usage: { cost: 0.01 } } });
          },
        );
        await withAiMetering(
          { operationClass: 'transcription', operationId: 'transcription:job-9:1' },
          () => {
            calls += 1;
            return Promise.resolve({ value: { text: 'b' }, finish: { usage: { cost: 0.01 } } });
          },
        );
      },
      { operationId: 'transcription:job-9' },
    );
    expect(calls).toBe(2);
    const ops = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(ops).toEqual(expect.arrayContaining(['transcription:job-9:0', 'transcription:job-9:1']));
  });

  it('recovers a completed worker call without calling the provider again', async () => {
    await pg.exec(`
      CREATE OR REPLACE FUNCTION fail_billing_settlement() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'settlement' THEN
          RAISE EXCEPTION 'settlement down';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_billing_settlement
      BEFORE INSERT ON billing_usage_ledger
      FOR EACH ROW EXECUTE FUNCTION fail_billing_settlement();
    `);
    const operationId = 'embedding:worker-retry';
    let calls = 0;
    const run = () =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () =>
          withAiMetering({ operationClass: 'embedding', operationId, model: 'embed-test' }, () => {
            calls += 1;
            return Promise.resolve({
              value: { text: 'kept' },
              finish: { usage: { cost: 0.04 } },
            });
          }),
        { operationId },
      );
    await expect(run()).rejects.toThrow(/billing_usage_ledger/);
    expect(calls).toBe(1);
    const [pending] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(pending?.state).toBe('reserved');
    expect(pending?.metadata).toMatchObject({
      provider_completed: true,
      worker_settlement_pending: true,
      openrouter_usd: 0.04,
      provider_value: { text: 'kept' },
      operation_class: 'embedding',
      model: 'embed-test',
    });
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET expires_at = NOW() - INTERVAL '1 hour'
      WHERE team_id = '${TEAM_ID}' AND operation_id = '${operationId}';
      DROP TRIGGER fail_billing_settlement ON billing_usage_ledger;
    `);
    expect(await expireStaleBillingReservations({ db, teamId: TEAM_ID })).toBe(0);
    expect(await settlePendingBillingReservations(db)).toBe(1);
    const [settledReservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(settledReservation?.state).toBe('settled');
    const [ledger] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, operationId));
    expect(ledger?.customerChargeCents).toBeGreaterThan(0);
    expect(ledger?.metadata).toMatchObject({ openrouter_usd: 0.04 });
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET state = 'expired', expires_at = NOW() - INTERVAL '1 hour'
      WHERE team_id = '${TEAM_ID}' AND operation_id = '${operationId}';
      DELETE FROM billing_usage_ledger
      WHERE team_id = '${TEAM_ID}' AND operation_id = '${operationId}';
    `);
    const retried = await run();
    expect(retried).toEqual({ text: 'kept' });
    expect(calls).toBe(1);
    const [afterRetry] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(afterRetry?.state).toBe('settled');
    expect(afterRetry?.metadata).toMatchObject({
      provider_completed: true,
      provider_value: { text: 'kept' },
    });
  });

  it('retries an Ask settlement saved on the reservation', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const operationId = 'ask:web:pending-1';
    expect((await reserveAskAi(billing, { operationId, deliverySurface: 'web' })).ok).toBe(true);
    await billing.patchReservationMetadata(operationId, {
      pending_settlement: true,
      pending_openrouter_usd: 0.05,
      pending_delivery_surface: 'web',
    });
    expect(await settlePendingBillingReservations(db)).toBe(1);
    const [reservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(reservation?.state).toBe('settled');
    const [ledger] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, operationId));
    expect(ledger?.customerChargeCents).toBeGreaterThan(0);
  });

  it('settles a delivered email from the reservation without sending it again', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const operationId = 'email_out:digest:retry';
    const reserved = await billing.reserve({
      operationId,
      meterId: 'email_units',
      reservedNativeUnits: 2,
      reservedChargeCents: 1,
    });
    expect(reserved.ok).toBe(true);
    await billing.patchReservationMetadata(operationId, {
      pending_settlement: true,
      pending_meter: 'email_units',
      pending_email_units: 2,
      pending_operation_class: 'email_outbound:daily_digest',
    });
    expect(await settlePendingBillingReservations(db)).toBe(1);
    const [reservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(reservation?.state).toBe('settled');
    const [ledger] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, operationId));
    expect(ledger?.meterId).toBe('email_units');
    expect(Number(ledger?.nativeUnits)).toBe(2);
  });

  it('does not expire an Ask reservation that still needs settlement', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const operationId = 'ask:web:pending-expire';
    expect((await reserveAskAi(billing, { operationId, deliverySurface: 'web' })).ok).toBe(true);
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"pending_settlement":true}'::jsonb,
          expires_at = NOW() - INTERVAL '2 hours'
      WHERE team_id = '${TEAM_ID}' AND operation_id = '${operationId}';
    `);
    expect(await expireStaleBillingReservations({ db, teamId: TEAM_ID })).toBe(0);
    const [reservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, operationId));
    expect(reservation?.state).toBe('reserved');
  });

  it('prices a replayed storage day on the plan in force that day', async () => {
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const yesterday = utcDayOffset(-1);
    const today = utcDay();
    const ym = periodYm();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', shadow_billing = false,
          included_discount_remaining_cents = 400, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_usage_counters (team_id, period_ym, meter_id, native_units, customer_charge_cents)
      VALUES ('${TEAM_ID}', '${ym}', 'storage_gb_month', 1, 0);
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at) VALUES
        ('${TEAM_ID}', 'team', '${yesterday}T00:00:00Z'),
        ('${TEAM_ID}', 'payg', '${today}T00:00:00Z');
      INSERT INTO documents (id, team_id, name, deleted_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000021',
        '${TEAM_ID}',
        'huge.bin',
        '${yesterday}T23:00:00Z'
      );
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000022',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000021',
        1,
        'team/docs/huge.bin',
        10737418240,
        '${yesterday}T00:00:00Z'
      );
    `);
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID });
    const [ledger] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, `storage_gb:${TEAM_ID}:${yesterday}`));
    expect(ledger?.metadata).toMatchObject({
      pricing_plan_id: 'team',
      pricing_period_ym: yesterday.slice(0, 7),
      invoice_cents: 0,
    });
    const discount = ledger?.metadata.discount_cents;
    expect(typeof discount).toBe('number');
    expect(discount).toBeGreaterThan(0);
    const [account] = await db
      .select({ included: teamBillingAccounts.includedDiscountRemainingCents })
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.included).toBe(400);
  });

  it('invoices same-plan PAYG storage recovered in a prior month', async () => {
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const day = '2026-09-15';
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', shadow_billing = false,
          included_discount_remaining_cents = 100, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_usage_counters (team_id, period_ym, meter_id, native_units, customer_charge_cents)
      VALUES ('${TEAM_ID}', '2026-09', 'storage_gb_month', 1, 0);
      INSERT INTO documents (id, team_id, name)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000041', '${TEAM_ID}', 'prior.bin');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000042',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000041',
        1,
        'team/docs/prior.bin',
        1073741824,
        '${day}T00:00:00Z'
      );
    `);
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID, day });
    const [ledger] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, `storage_gb:${TEAM_ID}:${day}`));
    const invoiceCents = ledger?.metadata.invoice_cents;
    expect(typeof invoiceCents).toBe('number');
    expect(invoiceCents).toBeGreaterThan(0);
    expect(ledger?.metadata.polar_ingest_status).not.toBe('not_required');
    const [account] = await db
      .select({
        included: teamBillingAccounts.includedDiscountRemainingCents,
        billingState: teamBillingAccounts.billingState,
      })
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.included).toBe(100);
    expect(account?.billingState).toBe('payg_active');
  });

  it('prices storage before comp expiry on the comp plan and Free after it', async () => {
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const before = '2026-08-20';
    const after = '2026-09-15';
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', arrangement = 'comped',
          comp_expires_at = '2026-09-01T00:00:00Z', shadow_billing = false,
          included_discount_remaining_cents = 0, spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_plan_history (team_id, plan_id, effective_at)
      VALUES ('${TEAM_ID}', 'team', '2026-08-01T00:00:00Z');
      INSERT INTO documents (id, team_id, name)
      VALUES ('cccccccc-dddd-4eee-8fff-000000000051', '${TEAM_ID}', 'comp.bin');
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000052',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000051',
        1,
        'team/docs/comp.bin',
        10737418240,
        '${before}T00:00:00Z'
      );
    `);
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID, day: before });
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID, day: after });
    const rows = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const beforeRow = rows.find((row) => row.operationId === `storage_gb:${TEAM_ID}:${before}`);
    const afterRow = rows.find((row) => row.operationId === `storage_gb:${TEAM_ID}:${after}`);
    expect(beforeRow?.metadata).toMatchObject({ pricing_plan_id: 'team' });
    expect(afterRow?.metadata.pricing_plan_id).toBeUndefined();
    expect(afterRow?.metadata.discount_cents).toBe(0);
    const [account] = await db
      .select({ billingState: teamBillingAccounts.billingState })
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM_ID));
    expect(account?.billingState).toBe('team_active');
  });

  it('skips storage days covered by a closed document absence interval', async () => {
    const billing = billingScopeMod.createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    const today = utcDay();
    const twoDaysAgo = utcDayOffset(-2);
    const yesterday = utcDayOffset(-1);
    await pg.exec(`
      INSERT INTO documents (id, team_id, name, metadata)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000031',
        '${TEAM_ID}',
        'gone.bin',
        '{"absence_intervals":[{"startedAt":"${twoDaysAgo}T12:00:00.000Z","endedAt":"${today}T00:00:00.000Z"}]}'::jsonb
      );
      INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, created_at)
      VALUES (
        'cccccccc-dddd-4eee-8fff-000000000032',
        '${TEAM_ID}',
        'cccccccc-dddd-4eee-8fff-000000000031',
        1,
        'team/docs/gone.bin',
        1073741824,
        '${twoDaysAgo}T00:00:00Z'
      );
    `);
    await snapshotTeamStorageGbMonth({ db, teamId: TEAM_ID });
    const ops = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(ops).toContain(`storage_gb:${TEAM_ID}:${twoDaysAgo}`);
    expect(ops).toContain(`storage_gb:${TEAM_ID}:${today}`);
    expect(ops).not.toContain(`storage_gb:${TEAM_ID}:${yesterday}`);
  });
});
