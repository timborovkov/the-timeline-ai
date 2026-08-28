import { PGlite } from '@electric-sql/pglite';
import {
  billingUsageLedger,
  billingUsageReservations,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  resetEnvForTests();
  await pg.close();
});

function enableLiveCharging(): void {
  process.env.BILLING_CHARGES_ENABLED = 'true';
  resetEnvForTests();
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

  it('stores auto-reload settings and returns a plan preview', async () => {
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
    const row = await scope.setAutoReload({
      enabled: true,
      thresholdCents: 500,
      amountCents: 1_000,
    });
    expect(row.autoReloadEnabled).toBe(true);
    expect(row.autoReloadAmountCents).toBe(1_000);
    const dash = await scope.getDashboard();
    expect(dash.planPreview.recommended).toBe('payg');
    expect(dash.activeMemberCount).toBe(1);
  });

  it('locks only the wallet remainder after included discount and settles that split', async () => {
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
          included_discount_remaining_cents = 50, wallet_balance_cents = 1000,
          spend_cap_cents = 10000
      WHERE team_id = '${TEAM_ID}';
    `);
    const reserved = await scope.reserve({
      operationId: 'op-discount',
      meterId: 'ai',
      reservedNativeUnits: 80,
      reservedChargeCents: 80,
    });
    expect(reserved.ok).toBe(true);
    expect((await scope.getAccount()).reservedBalanceCents).toBe(30);

    const settled = await scope.settle({
      operationId: 'op-discount',
      meterId: 'ai',
      nativeUnits: 80,
      customerChargeCents: 80,
    });
    expect(settled.ok).toBe(true);
    const after = await scope.getAccount();
    expect(after.reservedBalanceCents).toBe(0);
    expect(after.walletBalanceCents).toBe(970);
    expect(after.includedDiscountRemainingCents).toBe(0);
  });

  it('freezes the workspace when settlement wallet charge exceeds the reserved wallet', async () => {
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
        wallet_cents: 200,
        wallet_shortfall_cents: 120,
      });
    }
    const after = await scope.getAccount();
    expect(after.walletBalanceCents).toBe(0);
    expect(after.billingState).toBe('read_only');
    expect(after.spendCapCents).toBe(0);

    await scope.creditWallet({ operationId: 'topup-unfreeze', cents: 1_000, source: 'test' });
    const restored = await scope.getAccount();
    expect(restored.walletBalanceCents).toBe(880);
    expect(restored.billingState).toBe('team_active');
    expect(restored.spendCapCents).toBe(10_000);
  });

  it('keeps a frozen paid account frozen until the top-up covers the shortfall', async () => {
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
    await scope.creditWallet({ operationId: 'topup-partial', cents: 50, source: 'test' });
    const stillFrozen = await scope.getAccount();
    expect(stillFrozen.walletBalanceCents).toBe(0);
    expect(stillFrozen.billingState).toBe('read_only');
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

  it('keeps a shortfall-frozen account paused when the spend cap is raised', async () => {
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
    expect(row.billingState).toBe('read_only');
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
      wallet_reserved_cents: 0,
      wallet_lock_cents: 0,
    });
  });

  it('persists wallet_shortfall_cents on a refund reversal before freezing', async () => {
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
          wallet_balance_cents = 200
      WHERE team_id = '${TEAM_ID}';
    `);
    const result = await scope.debitWallet({
      operationId: 'polar_refund:order-1',
      cents: 1_000,
      freezeOnShortfall: true,
    });
    expect(result.duplicate).toBe(false);
    if (!result.duplicate) expect(result.shortfallCents).toBe(800);
    const [row] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.operationId, 'polar_refund:order-1'));
    expect(row?.metadata).toMatchObject({ cents: 1_000, wallet_shortfall_cents: 800 });
    const after = await scope.getAccount();
    expect(after.walletBalanceCents).toBe(0);
    expect(after.billingState).toBe('read_only');
  });

  it('does not lock PAYG wallet for usage still inside the Free floor', async () => {
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
    expect(account.walletBalanceCents).toBeLessThan(5000);
  });

  it('releases wallet locks from reservation provenance after the shadow flag flips', async () => {
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
    expect((await scope.getAccount()).reservedBalanceCents).toBe(80);
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

  it('reserves included discount only once across overlapping Team reservations', async () => {
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
    const second = await scope.reserve({
      operationId: 'op-disc-b',
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('usage_limit_reached');
  });

  it('does not Polar-ingest usage already collected from the prepaid wallet', async () => {
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
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
    `);
    await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(provider.events).toHaveLength(0);
    const retry = await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(retry.duplicate).toBe(true);
    expect(provider.events).toHaveLength(0);
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
    enableLiveCharging();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000
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
            wallet_balance_cents = 0, included_discount_remaining_cents = 0
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
      if (!reserved.ok) expect(reserved.code).toBe('usage_limit_reached');
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

  it('does not freeze Enterprise settlement against a prepaid spend cap', async () => {
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
    expect(provider.events.length).toBeGreaterThan(0);
    if (!settled.duplicate) {
      expect(settled.ledger.metadata).toMatchObject({ polar_ingest_status: 'pending' });
    }
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
