import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeBillingProvider } from '#src/billing/provider.js';
import { expireStaleBillingReservations } from '#src/billing/reservations.js';
import { createBillingScope, flushPendingPolarUsageIngest } from '#src/billing/scope.js';
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
  await pg.close();
});

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
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 50, wallet_balance_cents = 1000
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

  it('does not lock PAYG wallet for usage still inside the Free floor', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
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
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          wallet_balance_cents = 500, included_discount_remaining_cents = 0
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

  it('counts pending reservations against the spend cap', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
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

  it('blocks reservation when billing state is past_due', async () => {
    const scope = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await scope.getAccount();
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
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'team', billing_state = 'team_active',
          included_discount_remaining_cents = 1, wallet_balance_cents = 0
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

  it('retries Polar ingest after a duplicate local settlement', async () => {
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
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
    `);
    provider.ingestUsage = () => Promise.reject(new Error('polar down'));
    await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(provider.events).toHaveLength(0);
    const events: { name: string }[] = [];
    provider.ingestUsage = (event) => {
      events.push(event);
      return Promise.resolve();
    };
    const retry = await scope.settle({
      operationId: 'op-polar-1',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
    expect(retry.duplicate).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'timeline_recall_minutes',
      id: `timeline:${TEAM_ID}:op-polar-1`,
    });
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
    await pg.exec(`
      UPDATE team_billing_accounts
      SET shadow_billing = false, plan_id = 'payg', billing_state = 'payg_active',
          polar_customer_id = 'cus_test', wallet_balance_cents = 5000
      WHERE team_id = '${TEAM_ID}';
    `);
    provider.ingestUsage = () => Promise.reject(new Error('polar down'));
    await scope.settle({
      operationId: 'op-polar-claim',
      meterId: 'recall_minutes',
      nativeUnits: 70,
      customerChargeCents: 210,
    });
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
});
