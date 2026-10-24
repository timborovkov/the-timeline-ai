import { PGlite } from '@electric-sql/pglite';
import {
  billingUsageCounters,
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  daysInPeriodYm,
  memberDayChargeDelta,
  periodYmUtc,
  polarMemberMonthUnits,
} from '#src/billing/charge.js';
import { applyMeteredDiscountCents } from '#src/billing/operator.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import { createBillingScope, flushPendingPolarUsageIngest } from '#src/billing/scope.js';
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
    VALUES ('${TEAM_ID}', 'billing-test', 'Billing Test');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  delete process.env.BILLING_CHARGES_ENABLED;
  delete process.env.POLAR_PRODUCT_ID_PAYG;
  delete process.env.POLAR_PRODUCT_ID_TEAM;
  delete process.env.POLAR_PRODUCT_ID_BUSINESS;
  delete process.env.POLAR_PRODUCT_ID_ENTERPRISE;
  resetEnvForTests();
  await pg.close();
});

const POLAR_PRODUCT_IDS = {
  payg: 'prod_payg',
  team: 'prod_team',
  business: 'prod_business',
  enterprise: 'prod_enterprise',
} as const;

function enableLiveCharging(): void {
  process.env.BILLING_CHARGES_ENABLED = 'true';
  resetEnvForTests();
}

function enableCoveredPolar(plan: keyof typeof POLAR_PRODUCT_IDS): string {
  process.env.BILLING_CHARGES_ENABLED = 'true';
  process.env.POLAR_PRODUCT_ID_PAYG = POLAR_PRODUCT_IDS.payg;
  process.env.POLAR_PRODUCT_ID_TEAM = POLAR_PRODUCT_IDS.team;
  process.env.POLAR_PRODUCT_ID_BUSINESS = POLAR_PRODUCT_IDS.business;
  process.env.POLAR_PRODUCT_ID_ENTERPRISE = POLAR_PRODUCT_IDS.enterprise;
  resetEnvForTests();
  return POLAR_PRODUCT_IDS[plan];
}

describe('billing scope', () => {
  it('ensures an account, settles usage idempotently, and rolls up counters', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });

    const dash = await scope.getDashboard();
    expect(dash.account.planId).toBe('free');
    expect(dash.account.shadowBilling).toBe(true);

    const first = await scope.settle({
      operationId: 'op-ai-1',
      meterId: 'ai',
      nativeUnits: 42,
      customerChargeCents: 42,
      providerCostCents: 10,
      operationClass: 'agent_ask',
    });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await scope.settle({
      operationId: 'op-ai-1',
      meterId: 'ai',
      nativeUnits: 42,
      customerChargeCents: 42,
    });
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    const after = await scope.getDashboard();
    expect(after.meters.ai?.customerChargeCents).toBe(42);
    expect(after.meteredSpendCents).toBe(42);
    expect(provider.events).toHaveLength(0);
  });

  it('claims a person-level free grant once', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const first = await scope.claimFreeGrant();
    expect(first.ok).toBe(true);
    const second = await scope.claimFreeGrant();
    expect(second.ok).toBe(true);
  });

  it('does not abort the caller transaction when a second Free grant races', async () => {
    const extraTeamId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const first = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await first.claimFreeGrant()).ok).toBe(true);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${extraTeamId}', 'extra-grant', 'Extra Grant');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${extraTeamId}', '${USER_ID}', 'owner');
    `);
    await db.transaction(async (tx) => {
      const extra = createBillingScope({
        db: tx as unknown as Db,
        teamId: extraTeamId,
        userId: USER_ID,
        ensureMember: () => Promise.resolve('owner'),
      });
      const result = await extra.claimFreeGrant();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('free_grant_elsewhere');
      await tx
        .update(teamBillingAccounts)
        .set({ spendCapCents: 7, updatedAt: new Date() })
        .where(eq(teamBillingAccounts.teamId, extraTeamId));
    });
    const extraScope = createBillingScope({
      db,
      teamId: extraTeamId,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await extraScope.getAccount()).spendCapCents).toBe(7);
  });

  it('hard-stops Free AI allowance even while shadow billing is on', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.settle({
      operationId: 'op-ai-fill',
      meterId: 'ai',
      nativeUnits: 500,
      customerChargeCents: 500,
    });
    const blocked = await scope.reserve({
      operationId: 'op-ai-over',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('free_allowance_reached');
  });

  it('releases unused reservations', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const reserved = await scope.reserve({
      operationId: 'op-release',
      meterId: 'recall_minutes',
      reservedNativeUnits: 10,
      reservedChargeCents: 0,
    });
    expect(reserved.ok).toBe(true);
    const released = await scope.release('op-release');
    expect(released.ok).toBe(true);
    expect(released.missing).toBe(false);
  });

  it('returns a plan preview for the current paid plan', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active'
      WHERE team_id = '${TEAM_ID}';
    `);
    const dash = await scope.getDashboard();
    expect(dash.planPreview.recommended).toBe('payg');
    expect(dash.activeMemberCount).toBe(1);
  });

  it('applies included discount first and leaves the Polar invoice for the remainder', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 50, wallet_balance_cents = 1000,
          spend_cap_cents = 10000, polar_customer_id = 'cus_team',
          polar_subscription_id = 'sub_team', polar_product_id = '${POLAR_PRODUCT_IDS.team}'
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-discount',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(reserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);

    const settled = await scope.settle({
      operationId: 'op-discount',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    if (!settled.duplicate) {
      expect(settled.ledger.metadata).toMatchObject({
        discount_cents: 50,
        invoice_cents: 30,
        polar_ingest_units: 30,
        polar_ingest_charge_cents: 30,
        polar_ingest_status: 'pending',
      });
    }
    const after = await scope.getAccount();
    expect(after.reservedBalanceCents).toBe(0);
    expect(after.walletBalanceCents).toBe(1000);
    expect(after.includedDiscountRemainingCents).toBe(0);
  });

  it('records invoice cents without freezing when the wallet balance is below the charge', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 0, wallet_balance_cents = 80,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-excess',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(reserved.ok).toBe(true);

    const settled = await scope.settle({
      operationId: 'op-excess',
      meterId: 'ai',
      nativeUnits: 200,
      customerChargeCents: 200,
    });
    expect(settled.ok).toBe(true);
    expect(settled.duplicate).toBe(false);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBe(200);
      expect(settled.ledger.metadata).toMatchObject({
        invoice_cents: 200,
        polar_ingest_status: 'pending',
        polar_ingest_block: 'missing_subscription_price',
      });
    }
    const alerts = await pg.query<{ reason: string; meter_id: string }>(
      `SELECT reason, meter_id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toEqual([{ reason: 'missing_subscription_price', meter_id: 'ai' }]);
    const after = await scope.getAccount();
    expect(after.walletBalanceCents).toBe(80);
    expect(after.billingState).toBe('team_active');
    expect(after.spendCapCents).toBe(10_000);
  });

  it('does not freeze a paid plan when the wallet is empty and the spend cap still has room', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 0, wallet_balance_cents = 80,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-partial-topup',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(reserved.ok).toBe(true);
    const settled = await scope.settle({
      operationId: 'op-partial-topup',
      meterId: 'ai',
      nativeUnits: 200,
      customerChargeCents: 200,
    });
    expect(settled.ok).toBe(true);
    const after = await scope.getAccount();
    expect(after.walletBalanceCents).toBe(80);
    expect(after.billingState).toBe('team_active');
  });

  it('restores a frozen paid account when the spend cap is raised', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'read_only',
          wallet_balance_cents = 1000, spend_cap_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    const row = await scope.setSpendCap(2_500);
    expect(row.billingState).toBe('payg_active');
    expect(row.spendCapCents).toBe(2_500);
  });

  it('restores a read-only paid account when the spend cap is raised even if an old shortfall row remains', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'read_only',
          wallet_balance_cents = 0, spend_cap_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'refund-shortfall',
      kind: 'reversal',
      meterId: 'ai',
      nativeUnits: '0',
      customerChargeCents: 0,
      billable: false,
      nonBillableReason: 'wallet_refund',
      operationClass: 'wallet_refund',
      metadata: { cents: 1000, wallet_shortfall_cents: 400 },
    });
    const row = await scope.setSpendCap(10_000);
    expect(row.billingState).toBe('team_active');
    expect(row.spendCapCents).toBe(10_000);
  });

  it('does not take a Free wallet lock for in-allowance usage when live charging is on', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'free', billing_state = 'free',
          wallet_balance_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-free-live',
      meterId: 'ai',
      reservedNativeUnits: 100,
      reservedChargeCents: 100,
    });
    expect(reserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
    const [row] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, 'op-free-live'));
    expect(row?.metadata).toMatchObject({
      billable_charge_cents: 0,
      invoice_reserved_cents: 0,
      wallet_lock_cents: 0,
    });
  });

  it('does not invoice PAYG usage still inside the Free floor', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          wallet_balance_cents = 10
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-payg-floor',
      meterId: 'recall_minutes',
      reservedNativeUnits: 10,
      reservedChargeCents: 30,
    });
    expect(reserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
  });

  it('expires stale reservations and releases the wallet lock', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 500, included_discount_remaining_cents = 0,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-expire',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
      ttlMs: 1,
    });
    expect(reserved.ok).toBe(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    const expired = await expireStaleBillingReservations({ db, teamId: TEAM_ID });
    expect(expired).toBe(1);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
  });

  it('does not expire reservations that still need a Recall leave retry', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 500, included_discount_remaining_cents = 0,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-recall-leave',
      meterId: 'recall_minutes',
      reservedNativeUnits: 30,
      reservedChargeCents: 90,
      ttlMs: 1,
    });
    expect(reserved.ok).toBe(true);
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"pending_recall_leave_bot_id":"bot-keep"}'::jsonb,
          expires_at = NOW() - INTERVAL '1 hour'
      WHERE team_id = '${TEAM_ID}' AND operation_id = 'op-recall-leave';
    `);
    const expired = await expireStaleBillingReservations({ db, teamId: TEAM_ID });
    expect(expired).toBe(0);
    const [row] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, 'op-recall-leave'));
    expect(row?.state).toBe('reserved');
  });

  it('counts pending reservations against the spend cap', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, included_discount_remaining_cents = 0,
          spend_cap_cents = 1000
      WHERE team_id = '${TEAM_ID}';
    `);
    const first = await scope.reserve({
      operationId: 'op-cap-a',
      meterId: 'ai',
      reservedNativeUnits: 600,
      reservedChargeCents: 600,
    });
    expect(first.ok).toBe(true);
    const second = await scope.reserve({
      operationId: 'op-cap-b',
      meterId: 'ai',
      reservedNativeUnits: 600,
      reservedChargeCents: 600,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('spend_cap_reached');
  });

  it('rejects billable spend when the paid spend cap is 0', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, included_discount_remaining_cents = 0,
          spend_cap_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-zero-cap',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.code).toBe('spend_cap_reached');
  });

  it('does not spend included usage discount on extra member-days', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, included_discount_remaining_cents = 6000,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-member-days',
      meterId: 'member_days',
      nativeUnits: 1,
      customerChargeCents: 7,
    });
    expect(settled.ok).toBe(true);
    const account = await scope.getAccount();
    expect(account.includedDiscountRemainingCents).toBe(6000);
    expect(account.walletBalanceCents).toBe(5000);
    expect(account.billingState).toBe('team_active');
  });

  it('ingests extra member-days as member-month fractions at the commercial price', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, included_discount_remaining_cents = 6000,
          spend_cap_cents = 10000, polar_customer_id = 'cus_members',
          polar_subscription_id = 'sub_team', polar_product_id = '${POLAR_PRODUCT_IDS.team}',
          price_override = '{"includedActiveMembers":1,"additionalMemberCents":400,"meteredDiscountPercent":50}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-extra-member',
      meterId: 'member_days',
      nativeUnits: 1,
      customerChargeCents: 1,
    });
    expect(settled.ok).toBe(true);
    const days = daysInPeriodYm(periodYmUtc());
    const listCents = memberDayChargeDelta({
      previousNativeUnits: 0,
      nextNativeUnits: 1,
      centsPerMemberMonth: 400,
      daysInMonth: days,
    });
    const invoiceCents = applyMeteredDiscountCents(listCents, 50);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBe(invoiceCents);
      expect(settled.ledger.metadata).toMatchObject({
        discount_cents: 0,
        invoice_cents: invoiceCents,
        polar_ingest_name: 'timeline_extra_member_days',
        polar_ingest_units: polarMemberMonthUnits(invoiceCents),
        polar_ingest_charge_cents: invoiceCents,
        polar_ingest_status: 'pending',
      });
    }
    expect(provider.events).toEqual([
      expect.objectContaining({
        name: 'timeline_extra_member_days',
        units: polarMemberMonthUnits(invoiceCents),
        externalCustomerId: TEAM_ID,
      }),
    ]);
    const account = await scope.getAccount();
    expect(account.includedDiscountRemainingCents).toBe(6000);
    expect(account.billingState).toBe('team_active');
  });

  it('keeps a comped extra member-day off Polar and still freezes at the spend cap', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', shadow_billing = false, plan_id = 'team',
          billing_state = 'team_active', wallet_balance_cents = 5000,
          included_discount_remaining_cents = 6000, spend_cap_cents = 0,
          polar_customer_id = 'cus_comp_members', comp_reason = 'internal'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-comp-member',
      meterId: 'member_days',
      nativeUnits: 1,
      customerChargeCents: 1,
    });
    expect(settled.ok).toBe(true);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBeGreaterThan(0);
      expect(settled.ledger.metadata).toMatchObject({ polar_ingest_status: 'not_required' });
    }
    expect(provider.events).toHaveLength(0);
    const account = await scope.getAccount();
    expect(account.billingState).toBe('read_only');
    expect(account.includedDiscountRemainingCents).toBe(6000);
  });

  it('unwinds a historical wallet lock and does not lock new reservations', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 500, included_discount_remaining_cents = 0,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-lock-live',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(reserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
    await pg.exec(`
      UPDATE team_billing_accounts
      SET reserved_balance_cents = 80
      WHERE team_id = '${TEAM_ID}';
      UPDATE billing_usage_reservations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"wallet_lock_cents":80}'::jsonb
      WHERE team_id = '${TEAM_ID}' AND operation_id = 'op-lock-live';
    `);
    delete process.env.BILLING_CHARGES_ENABLED;
    resetEnvForTests();
    await scope.release('op-lock-live');
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET reserved_balance_cents = 0, wallet_balance_cents = 500
      WHERE team_id = '${TEAM_ID}';
    `);
    const shadowReserved = await scope.reserve({
      operationId: 'op-lock-shadow',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(shadowReserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
    enableLiveCharging();
    await scope.release('op-lock-shadow');
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
  });

  it('blocks reservation when billing state is past_due', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'past_due',
          wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-past-due',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.code).toBe('usage_limit_reached');
  });

  it('counts in-flight Free reservations against the native allowance', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.settle({
      operationId: 'op-email-fill',
      meterId: 'email_units',
      nativeUnits: 499,
      customerChargeCents: 0,
    });
    const first = await scope.reserve({
      operationId: 'op-email-a',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(first.ok).toBe(true);
    const second = await scope.reserve({
      operationId: 'op-email-b',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('free_allowance_reached');
  });

  it('re-reserves a released operation id after a failed provider attempt', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const first = await scope.reserve({
      operationId: 'op-retry',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(first.ok).toBe(true);
    await scope.release('op-retry');
    const retry = await scope.reserve({
      operationId: 'op-retry',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.alreadySettled).toBeUndefined();
  });

  it('does not treat a settled reservation as an active lock', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.reserve({
      operationId: 'op-settled',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    await scope.settle({
      operationId: 'op-settled',
      meterId: 'email_units',
      nativeUnits: 1,
      customerChargeCents: 0,
    });
    const retry = await scope.reserve({
      operationId: 'op-settled',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.alreadySettled).toBe(true);
  });

  it('reserves included discount once and invoices the next overlapping Team charge', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 1, wallet_balance_cents = 0,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const first = await scope.reserve({
      operationId: 'op-disc-a',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.reservation.metadata).toMatchObject({
        discount_reserved_cents: 1,
        invoice_reserved_cents: 0,
        wallet_lock_cents: 0,
      });
    }
    const second = await scope.reserve({
      operationId: 'op-disc-b',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.reservation.metadata).toMatchObject({
        discount_reserved_cents: 0,
        invoice_reserved_cents: 1,
        wallet_lock_cents: 0,
      });
    }
    expect((await scope.getAccount()).reservedBalanceCents).toBe(0);
  });

  it('ingests PAYG overage above the Free floor onto the Polar invoice', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('payg');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000,
          polar_subscription_id = 'sub_payg', polar_product_id = '${POLAR_PRODUCT_IDS.payg}'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(settled.ok).toBe(true);
    expect(provider.events).toEqual([
      expect.objectContaining({
        name: 'timeline_recall_minutes',
        units: 10,
        externalCustomerId: TEAM_ID,
        id: `timeline:${TEAM_ID}:op-polar-1`,
      }),
    ]);
    const retry = await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(retry.duplicate).toBe(true);
    expect(provider.events).toHaveLength(1);
  });

  it('claims Polar outbox rows so concurrent ingest sends one event', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('payg');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000,
          polar_subscription_id = 'sub_payg', polar_product_id = '${POLAR_PRODUCT_IDS.payg}'
      WHERE team_id = '${TEAM_ID}';
    `);
    await scope.settle({
      operationId: 'op-polar-claim',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    await pg.exec(`
      UPDATE billing_usage_ledger
      SET metadata = metadata || jsonb_build_object(
        'polar_ingest_status', 'pending',
        'polar_ingest_name', 'timeline_recall_minutes',
        'polar_ingest_units', 10,
        'polar_ingest_customer_id', '${TEAM_ID}',
        'polar_ingest_operation_id', 'op-polar-claim',
        'polar_ingest_charge_cents', 30
      )
      WHERE team_id = '${TEAM_ID}' AND operation_id = 'op-polar-claim';
    `);
    const events: { id?: string }[] = [];
    let inflight = 0;
    let maxInflight = 0;
    provider.ingestUsage = async (event) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflight -= 1;
    };
    await Promise.all([
      flushPendingPolarUsageIngest({ db, provider, teamId: TEAM_ID }),
      flushPendingPolarUsageIngest({ db, provider, teamId: TEAM_ID }),
    ]);
    expect(events).toHaveLength(1);
    expect(maxInflight).toBe(1);
    expect(events[0]?.id).toBe(`timeline:${TEAM_ID}:op-polar-claim`);
  });

  it('accumulates sub-cent AI charges across settlements', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.settle({
      operationId: 'op-ai-frac-1',
      meterId: 'ai',
      nativeUnits: 0.4,
      customerChargeCents: 0,
    });
    await scope.settle({
      operationId: 'op-ai-frac-2',
      meterId: 'ai',
      nativeUnits: 0.4,
      customerChargeCents: 0,
    });
    const dash = await scope.getDashboard();
    expect(dash.meters.ai?.nativeUnits).toBeCloseTo(0.8);
    expect(dash.meters.ai?.customerChargeCents).toBe(1);
  });

  it('accumulates sub-cent accepted-source charges from locked counters', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    for (let i = 0; i < 20; i += 1) {
      await scope.settle({
        operationId: `op-src-${String(i)}`,
        meterId: 'accepted_sources',
        nativeUnits: 1,
        customerChargeCents: 0,
      });
    }
    const dash = await scope.getDashboard();
    expect(dash.meters.accepted_sources?.nativeUnits).toBe(20);
    expect(dash.meters.accepted_sources?.customerChargeCents).toBe(1);
  });

  it('ingests the cumulative Team email cent and skips the sub-cent settles', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 0, wallet_balance_cents = 5000,
          polar_customer_id = 'cus_team',
          polar_subscription_id = 'sub_team', polar_product_id = '${POLAR_PRODUCT_IDS.team}'
      WHERE team_id = '${TEAM_ID}';
    `);
    for (let i = 0; i < 4; i += 1) {
      const settled = await scope.settle({
        operationId: `op-email-polar-${String(i)}`,
        meterId: 'email_units',
        nativeUnits: 1,
        customerChargeCents: 0,
      });
      expect(settled.ok).toBe(true);
      if (!settled.duplicate) {
        expect(settled.ledger.metadata).toMatchObject({
          polar_ingest_status: i === 1 ? 'pending' : 'not_required',
        });
      }
    }
    expect(provider.events).toEqual([
      expect.objectContaining({
        name: 'timeline_email_units',
        units: 4,
        externalCustomerId: TEAM_ID,
      }),
    ]);
    const dash = await scope.getDashboard();
    expect(dash.meters.email_units?.nativeUnits).toBe(4);
    expect(dash.meters.email_units?.customerChargeCents).toBe(1);
  });

  it('invoices half of a stream of one-cent charges when the metered discount is 50%', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active', shadow_billing = true,
          price_override = '{"meteredDiscountPercent":50}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    for (let i = 0; i < 100; i += 1) {
      await scope.settle({
        operationId: `op-half-${String(i)}`,
        meterId: 'ai',
        nativeUnits: 1,
        customerChargeCents: 1,
      });
    }
    const dash = await scope.getDashboard();
    expect(dash.meters.ai?.customerChargeCents).toBe(50);
  });

  it('holds a payable meter when the product id matches but the meter is unpriced', async () => {
    const provider = createFakeBillingProvider();
    provider.pricedEventNamesByProduct.set(POLAR_PRODUCT_IDS.team, ['timeline_extra_member_days']);
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 0, polar_customer_id = 'cus_team',
          polar_subscription_id = 'sub_team', polar_product_id = '${POLAR_PRODUCT_IDS.team}'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-unpriced-ai',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    expect(provider.events).toHaveLength(0);
    if (!settled.duplicate) {
      expect(settled.ledger.metadata).toMatchObject({
        polar_ingest_status: 'pending',
        polar_ingest_block: 'missing_subscription_price',
      });
    }
    const alerts = await pg.query<{ meter_id: string }>(
      `SELECT meter_id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toEqual([{ meter_id: 'ai' }]);
  });

  it('does not keep Free allowance usage pending for a later Polar invoice', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'free', billing_state = 'free'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-free-ai',
      meterId: 'ai',
      nativeUnits: 20,
      customerChargeCents: 20,
    });
    expect(settled.ok).toBe(true);
    expect(provider.events).toHaveLength(0);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBe(20);
      expect(settled.ledger.metadata).toMatchObject({
        polar_ingest_status: 'not_required',
        invoice_cents: 0,
      });
      expect(settled.ledger.metadata).not.toHaveProperty('polar_ingest_units');
      expect(settled.ledger.metadata).not.toMatchObject({
        polar_ingest_block: 'missing_subscription_price',
      });
    }
    const account = await scope.getAccount();
    expect(account.billingState).toBe('free');
    expect(account.spendCapCents).toBeGreaterThanOrEqual(0);
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active',
          polar_customer_id = 'cus_upgrade', polar_subscription_id = 'sub_team',
          polar_product_id = '${POLAR_PRODUCT_IDS.team}'
      WHERE team_id = '${TEAM_ID}';
    `);
    await flushPendingPolarUsageIngest({ db, provider, teamId: TEAM_ID });
    expect(provider.events).toHaveLength(0);
  });

  it('attributes a backfilled storage day to that month', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    await scope.settle({
      operationId: 'storage_gb:backfill:2026-09-30',
      meterId: 'storage_gb_month',
      nativeUnits: 0.1,
      customerChargeCents: 1,
      usageAt: new Date('2026-09-30T12:00:00Z'),
      pricingPeriodYm: '2026-09',
    });
    const [counter] = await db
      .select()
      .from(billingUsageCounters)
      .where(
        and(
          eq(billingUsageCounters.teamId, TEAM_ID),
          eq(billingUsageCounters.meterId, 'storage_gb_month'),
        ),
      );
    expect(counter?.periodYm).toBe('2026-09');
  });

  it('reuses a settled reservation after the spend cap would reject new work', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          spend_cap_cents = 1000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-settled-retry',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(reserved.ok).toBe(true);
    await scope.settle({
      operationId: 'op-settled-retry',
      meterId: 'ai',
      nativeUnits: 10,
      customerChargeCents: 10,
    });
    await pg.exec(`
      UPDATE team_billing_accounts
      SET spend_cap_cents = 0, billing_state = 'team_active'
      WHERE team_id = '${TEAM_ID}';
    `);
    const again = await scope.reserve({
      operationId: 'op-settled-retry',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.alreadySettled).toBe(true);
  });

  it('enforces the spend cap on a comped Enterprise workspace', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', shadow_billing = false, plan_id = 'enterprise',
          billing_state = 'enterprise_active', spend_cap_cents = 0, comp_reason = 'internal'
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-comp-enterprise',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.code).toBe('spend_cap_reached');
  });

  it('counts open reservations against a comped Enterprise spend cap', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', shadow_billing = false, plan_id = 'enterprise',
          billing_state = 'enterprise_active', spend_cap_cents = 15, comp_reason = 'internal'
      WHERE team_id = '${TEAM_ID}';
    `);
    const first = await scope.reserve({
      operationId: 'op-comp-enterprise-open',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(first.ok).toBe(true);
    const second = await scope.reserve({
      operationId: 'op-comp-enterprise-over',
      meterId: 'ai',
      reservedNativeUnits: 10,
      reservedChargeCents: 10,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('spend_cap_reached');
  });

  it('accumulates sub-cent email charges from locked counters', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    for (let i = 0; i < 4; i += 1) {
      await scope.settle({
        operationId: `op-email-${String(i)}`,
        meterId: 'email_units',
        nativeUnits: 1,
        customerChargeCents: 0,
      });
    }
    const dash = await scope.getDashboard();
    expect(dash.meters.email_units?.nativeUnits).toBe(4);
    expect(dash.meters.email_units?.customerChargeCents).toBe(1);
  });

  it('rechecks the Ask-turn cap inside the account lock', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    await pg.exec(`
      INSERT INTO billing_usage_reservations (
        team_id, operation_id, meter_id, reserved_native_units, reserved_charge_cents, expires_at
      )
      SELECT '${TEAM_ID}', 'ask:web:' || g, 'ai', 1, 1, now() + interval '1 hour'
      FROM generate_series(1, 99) AS g;
    `);
    const [first, second] = await Promise.all([
      scope.reserve({
        operationId: 'ask:web:lock-a',
        meterId: 'ai',
        reservedNativeUnits: 1,
        reservedChargeCents: 1,
      }),
      scope.reserve({
        operationId: 'ask:web:lock-b',
        meterId: 'ai',
        reservedNativeUnits: 1,
        reservedChargeCents: 1,
      }),
    ]);
    expect([first, second].filter((row) => row.ok)).toHaveLength(1);
    expect([first, second].some((row) => !row.ok && row.code === 'usage_limit_reached')).toBe(true);
  });

  it('treats existing shadow rows as live charging once BILLING_CHARGES_ENABLED is on', async () => {
    const previous = process.env.BILLING_CHARGES_ENABLED;
    process.env.BILLING_CHARGES_ENABLED = 'true';
    resetEnvForTests();
    try {
      const scope = createBillingScope({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        ensureMember: () => Promise.resolve('owner'),
      });
      await scope.getAccount();
      await pg.exec(`
        UPDATE team_billing_accounts
        SET shadow_billing = true, plan_id = 'team', billing_state = 'team_active',
            wallet_balance_cents = 0, included_discount_remaining_cents = 0,
            spend_cap_cents = 0
        WHERE team_id = '${TEAM_ID}';
      `);
      const dash = await scope.getDashboard();
      expect(dash.account.shadowBilling).toBe(false);
      const reserved = await scope.reserve({
        operationId: 'op-live-toggle',
        meterId: 'ai',
        reservedNativeUnits: 80,
        reservedChargeCents: 80,
      });
      expect(reserved.ok).toBe(false);
      if (!reserved.ok) expect(reserved.code).toBe('spend_cap_reached');
    } finally {
      if (previous === undefined) delete process.env.BILLING_CHARGES_ENABLED;
      else process.env.BILLING_CHARGES_ENABLED = previous;
      resetEnvForTests();
    }
  });

  it('attributes Recall minutes that cross a UTC month to both periods', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 10000, wallet_balance_cents = 5000,
          spend_cap_cents = 100000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'recall-span',
      meterId: 'recall_minutes',
      reservedNativeUnits: 120,
      reservedChargeCents: 360,
    });
    expect(reserved.ok).toBe(true);
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET created_at = '2026-08-31T23:00:00Z'
      WHERE team_id = '${TEAM_ID}' AND operation_id = 'recall-span';
    `);
    const settled = await scope.settle({
      operationId: 'recall-span',
      meterId: 'recall_minutes',
      nativeUnits: 120,
      customerChargeCents: 360,
    });
    expect(settled.ok).toBe(true);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBe(360);
      expect(settled.ledger.metadata).toMatchObject({
        period_segments: [
          { period_ym: '2026-08', native_units: 60, customer_charge_cents: 180 },
          { period_ym: '2026-09', native_units: 60, customer_charge_cents: 180 },
        ],
      });
    }
    const counters = await pg.query<{ period_ym: string; native_units: string }>(
      `SELECT period_ym, native_units::text
       FROM billing_usage_counters
       WHERE team_id = '${TEAM_ID}' AND meter_id = 'recall_minutes'
       ORDER BY period_ym`,
    );
    expect(counters.rows).toEqual([
      { period_ym: '2026-08', native_units: '60.000000' },
      { period_ym: '2026-09', native_units: '60.000000' },
    ]);
  });

  it('holds Enterprise usage that has no subscription price and does not freeze', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active',
          wallet_balance_cents = 500, spend_cap_cents = 0, included_discount_remaining_cents = 0,
          polar_customer_id = 'cus_enterprise'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-enterprise-ai',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    const after = await scope.getAccount();
    expect(after.billingState).toBe('enterprise_active');
    expect(after.spendCapCents).toBe(0);
    expect(after.walletBalanceCents).toBe(500);
    expect(provider.events).toHaveLength(0);
    if (!settled.duplicate) {
      expect(settled.ledger.metadata).toMatchObject({
        polar_ingest_status: 'pending',
        polar_ingest_block: 'missing_subscription_price',
      });
    }
    const alerts = await pg.query<{ meter_id: string }>(
      `SELECT meter_id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toEqual([{ meter_id: 'ai' }]);
  });

  it('ingests Enterprise usage once the subscription product matches', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('enterprise');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active',
          wallet_balance_cents = 500, spend_cap_cents = 0, included_discount_remaining_cents = 0,
          polar_customer_id = 'cus_enterprise',
          polar_subscription_id = 'sub_enterprise',
          polar_product_id = '${POLAR_PRODUCT_IDS.enterprise}'
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-enterprise-covered',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    const after = await scope.getAccount();
    expect(after.billingState).toBe('enterprise_active');
    expect(after.spendCapCents).toBe(0);
    expect(provider.events.length).toBeGreaterThan(0);
    const open = await pg.query(
      `SELECT id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(open.rows).toHaveLength(0);
  });

  it('keeps a held charge pending while shadow billing is on, then ingests it', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, spend_cap_cents = 10000,
          polar_customer_id = 'cus_hold', included_discount_remaining_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-hold-then-cover',
      meterId: 'ai',
      nativeUnits: 40,
      customerChargeCents: 40,
    });
    expect(settled.ok).toBe(true);
    expect(provider.events).toHaveLength(0);
    delete process.env.BILLING_CHARGES_ENABLED;
    resetEnvForTests();
    await flushPendingPolarUsageIngest({ db, provider, teamId: TEAM_ID });
    expect(provider.events).toHaveLength(0);
    const held = await pg.query<{ status: string }>(
      `SELECT metadata->>'polar_ingest_status' AS status
       FROM billing_usage_ledger
       WHERE team_id = '${TEAM_ID}' AND operation_id = 'op-hold-then-cover'`,
    );
    expect(held.rows[0]?.status).toBe('pending');
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET polar_subscription_id = 'sub_team', polar_product_id = '${POLAR_PRODUCT_IDS.team}'
      WHERE team_id = '${TEAM_ID}';
    `);
    await flushPendingPolarUsageIngest({ db, provider, teamId: TEAM_ID });
    expect(provider.events).toEqual([
      expect.objectContaining({ name: 'timeline_ai_eur_cents', externalCustomerId: TEAM_ID }),
    ]);
    const open = await pg.query(
      `SELECT id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(open.rows).toHaveLength(0);
  });

  it('meters a comped team without Polar or wallet charges and still enforces the spend cap', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 500, spend_cap_cents = 100,
          polar_customer_id = 'cus_comp', comp_reason = 'internal'
      WHERE team_id = '${TEAM_ID}';
    `);
    const first = await scope.settle({
      operationId: 'op-comp-1',
      meterId: 'ai',
      nativeUnits: 40,
      customerChargeCents: 40,
    });
    expect(first.ok).toBe(true);
    if (!first.duplicate) {
      expect(first.ledger.metadata).toMatchObject({ polar_ingest_status: 'not_required' });
      expect(first.ledger.customerChargeCents).toBeGreaterThan(0);
    }
    const afterFirst = await scope.getAccount();
    expect(afterFirst.walletBalanceCents).toBe(500);
    expect(afterFirst.billingState).toBe('team_active');
    expect(provider.events).toHaveLength(0);

    const second = await scope.settle({
      operationId: 'op-comp-2',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(second.ok).toBe(true);
    const afterSecond = await scope.getAccount();
    expect(afterSecond.billingState).toBe('read_only');
    expect(afterSecond.walletBalanceCents).toBe(500);
    await expect(scope.setSpendCap(50_000)).rejects.toThrow(/operators/i);
  });

  it('applies a per-team metered discount before the spend cap', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 5000, spend_cap_cents = 10000,
          price_override = '{"meteredDiscountPercent":50}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-discounted',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    if (!settled.duplicate) expect(settled.ledger.customerChargeCents).toBe(40);
  });

  it('sends Polar the discounted AI units when included credit is gone', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    enableCoveredPolar('team');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 0, spend_cap_cents = 100000,
          polar_customer_id = 'cus_discount', polar_subscription_id = 'sub_team',
          polar_product_id = '${POLAR_PRODUCT_IDS.team}',
          price_override = '{"meteredDiscountPercent":50}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const settled = await scope.settle({
      operationId: 'op-discount-units',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    if (!settled.duplicate) {
      expect(settled.ledger.customerChargeCents).toBe(40);
      expect(settled.ledger.metadata).toMatchObject({
        invoice_cents: 40,
        polar_ingest_units: 40,
        polar_ingest_charge_cents: 40,
        polar_ingest_status: 'pending',
      });
    }
    expect(provider.events).toEqual([
      expect.objectContaining({
        name: 'timeline_ai_eur_cents',
        units: 40,
        externalCustomerId: TEAM_ID,
      }),
    ]);
  });

  it('forces shadow mode when BILLING_CHARGES_ENABLED is off even if the row is live', async () => {
    const provider = createFakeBillingProvider();
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
      provider,
    });
    await scope.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          wallet_balance_cents = 5000, polar_customer_id = 'cus_test'
      WHERE team_id = '${TEAM_ID}';
    `);
    const dash = await scope.getDashboard();
    expect(dash.account.shadowBilling).toBe(true);
    const settled = await scope.settle({
      operationId: 'op-shadow-kill-switch',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    expect((await scope.getAccount()).walletBalanceCents).toBe(5000);
    expect(provider.events).toHaveLength(0);
    if (!settled.duplicate) {
      expect(settled.ledger.metadata).toMatchObject({ polar_ingest_status: 'not_required' });
    }
  });

  it('resets reservation createdAt when reactivating a released row', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const first = await scope.reserve({
      operationId: 'op-reactivate',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(first.ok).toBe(true);
    await scope.release('op-reactivate');
    await pg.exec(`
      UPDATE billing_usage_reservations
      SET created_at = '2026-07-01T00:00:00Z'
      WHERE team_id = '${TEAM_ID}' AND operation_id = 'op-reactivate';
    `);
    const retry = await scope.reserve({
      operationId: 'op-reactivate',
      meterId: 'email_units',
      reservedNativeUnits: 1,
      reservedChargeCents: 0,
    });
    expect(retry.ok).toBe(true);
    const [row] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.operationId, 'op-reactivate'));
    expect(row?.createdAt.getTime()).toBeGreaterThan(Date.parse('2026-07-02T00:00:00Z'));
  });

  it('rejects a second concurrent worker AI reservation on Free', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const first = await scope.reserve({
      operationId: 'op-worker-1',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
      metadata: { source: 'worker' },
    });
    expect(first.ok).toBe(true);
    const second = await scope.reserve({
      operationId: 'op-worker-2',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
      metadata: { source: 'worker' },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('costly_worker_busy');
    const search = await scope.reserve({
      operationId: 'op-search-1',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
      metadata: { source: 'search' },
    });
    expect(search.ok).toBe(true);
  });
});
