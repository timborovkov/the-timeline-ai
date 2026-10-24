import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  billingStateFromPolarSubscriptionStatus,
  handlePolarWebhookEvent,
  polarTopupRefundRequest,
  shouldApplyPaidSubscriptionUpdate,
  shouldResetIncludedDiscount,
  spendCapCentsForPaidActivation,
} from '#src/billing/polar-webhook.js';
import { createBillingScope } from '#src/billing/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const PRODUCTS = {
  payg: 'prod_payg',
  team: 'prod_team',
  business: 'prod_business',
  topup: 'prod_topup',
};

async function enablePrepaidWallet(): Promise<void> {
  const billing = createBillingScope({
    db,
    teamId: TEAM_ID,
    userId: USER_ID,
    ensureMember: () => Promise.resolve('owner'),
  });
  await billing.getAccount();
  await pg.exec(`
    UPDATE team_billing_accounts
    SET plan_id = 'payg', billing_state = 'payg_active'
    WHERE team_id = '${TEAM_ID}';
  `);
}

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'polar-hook', 'Polar Hook');
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

describe('Polar webhook helpers', () => {
  it('uses the cumulative refunded total on order.refunded', () => {
    expect(
      polarTopupRefundRequest({
        eventType: 'order.refunded',
        amount: 1000,
        refundedAmount: 200,
      }),
    ).toEqual({ cents: 200, amountKind: 'cumulative' });
    expect(
      polarTopupRefundRequest({
        eventType: 'refund.created',
        amount: 200,
        refundedAmount: 200,
      }),
    ).toEqual({ cents: 200, amountKind: 'incremental' });
    expect(polarTopupRefundRequest({ eventType: 'order.refunded', amount: 1000 })).toEqual({
      cents: 1000,
      amountKind: 'cumulative',
    });
  });

  it('maps Polar subscription status instead of activating from product id', () => {
    expect(billingStateFromPolarSubscriptionStatus('team', 'active')).toBe('team_active');
    expect(billingStateFromPolarSubscriptionStatus('team', 'past_due')).toBe('past_due');
    expect(billingStateFromPolarSubscriptionStatus('payg', 'unpaid')).toBe('past_due');
    expect(billingStateFromPolarSubscriptionStatus('team', 'canceled')).toBe('canceled');
    expect(billingStateFromPolarSubscriptionStatus('business', 'mystery')).toBe('ignore');
  });

  it('resets included discount only on new row, plan/subscription change, or new period', () => {
    const existing = {
      planId: 'team' as const,
      polarSubscriptionId: 'sub_1',
      periodEndsAt: new Date('2026-09-01T00:00:00Z'),
    };
    expect(
      shouldResetIncludedDiscount({
        existing: existing as never,
        planId: 'team',
        polarSubscriptionId: 'sub_1',
        periodEndsAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toBe(false);
    expect(
      shouldResetIncludedDiscount({
        existing: existing as never,
        planId: 'team',
        polarSubscriptionId: 'sub_1',
        periodEndsAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ).toBe(true);
    expect(
      shouldResetIncludedDiscount({
        existing: {
          ...existing,
          periodStartedAt: new Date('2026-08-15T00:00:00Z'),
        } as never,
        planId: 'team',
        polarSubscriptionId: 'sub_1',
        periodStartedAt: new Date('2026-08-15T00:00:00Z'),
        periodEndsAt: new Date('2026-09-15T00:00:00Z'),
      }),
    ).toBe(false);
    expect(
      shouldResetIncludedDiscount({
        existing: existing as never,
        planId: 'business',
        polarSubscriptionId: 'sub_1',
        periodEndsAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toBe(true);
  });

  it('preserves a paid spend cap of 0 and only defaults when activating from Free', () => {
    expect(
      spendCapCentsForPaidActivation({
        existing: { planId: 'team', spendCapCents: 0 } as never,
        plan: 'team',
      }),
    ).toBe(0);
    expect(
      spendCapCentsForPaidActivation({
        existing: { planId: 'payg', spendCapCents: 0 } as never,
        plan: 'payg',
      }),
    ).toBe(0);
    expect(
      spendCapCentsForPaidActivation({
        existing: { planId: 'free', spendCapCents: 0 } as never,
        plan: 'payg',
      }),
    ).toBe(2_500);
    expect(spendCapCentsForPaidActivation({ existing: undefined, plan: 'team' })).toBe(10_000);
  });
});

describe('handlePolarWebhookEvent', () => {
  it('applies shadowBilling on insert and conflict, and does not refill discount on retries', async () => {
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_1',
          status: 'active',
          product_id: 'prod_team',
          current_period_end: '2026-09-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const first = await billing.getAccount();
    expect(first.shadowBilling).toBe(false);
    expect(first.includedDiscountRemainingCents).toBe(6_000);
    expect(first.polarSubscriptionId).toBe('sub_1');

    await pg.exec(`
      UPDATE team_billing_accounts
      SET included_discount_remaining_cents = 12, shadow_billing = true
      WHERE team_id = '${TEAM_ID}';
    `);

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_1',
          status: 'active',
          product_id: 'prod_team',
          current_period_end: '2026-09-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const retry = await billing.getAccount();
    expect(retry.shadowBilling).toBe(false);
    expect(retry.includedDiscountRemainingCents).toBe(12);
  });

  it('does not activate past_due subscriptions and ignores order.paid plan products', async () => {
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_due',
          status: 'past_due',
          product_id: 'prod_team',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).billingState).toBe('past_due');
    await pg.exec(`
      UPDATE team_billing_accounts
      SET included_discount_remaining_cents = 12
      WHERE team_id = '${TEAM_ID}';
    `);

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_plan',
          product_id: 'prod_team',
          amount: 4900,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).includedDiscountRemainingCents).toBe(12);
  });

  it('cancels only when polarSubscriptionId matches the event id', async () => {
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_new',
          status: 'active',
          product_id: 'prod_business',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.canceled',
        data: {
          id: 'sub_old',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const kept = await billing.getAccount();
    expect(kept.planId).toBe('business');
    expect(kept.billingState).toBe('business_active');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.canceled',
        data: {
          id: 'sub_new',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const canceled = await billing.getAccount();
    expect(canceled.planId).toBe('free');
    expect(canceled.billingState).toBe('restricted');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_new',
          status: 'active',
          product_id: 'prod_business',
          modified_at: '2020-01-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const ignoredStale = await billing.getAccount();
    expect(ignoredStale.billingState).toBe('restricted');
    expect(ignoredStale.planId).toBe('free');
  });

  it('applies the paid plan default spend cap when upgrading from Free', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).spendCapCents).toBe(0);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_payg',
          status: 'active',
          product_id: 'prod_payg',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).spendCapCents).toBe(2_500);
  });

  it('preserves a paid spend cap of 0 across subscription.updated', async () => {
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_payg',
          status: 'active',
          product_id: 'prod_payg',
          modified_at: '2026-08-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await pg.exec(`
      UPDATE team_billing_accounts SET spend_cap_cents = 0 WHERE team_id = '${TEAM_ID}';
    `);
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_payg',
          status: 'active',
          product_id: 'prod_payg',
          modified_at: '2026-08-02T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).spendCapCents).toBe(0);
    expect((await billing.getAccount()).billingState).toBe('payg_active');
  });

  it('ignores an older Polar subscription event after locking the billing account', async () => {
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_team',
          status: 'active',
          product_id: 'prod_team',
          modified_at: '2026-08-10T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_team',
          status: 'past_due',
          product_id: 'prod_team',
          modified_at: '2026-08-09T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const kept = await billing.getAccount();
    expect(kept.billingState).toBe('team_active');
    expect(kept.polarEventModifiedAt?.toISOString()).toBe('2026-08-10T00:00:00.000Z');

    await Promise.all([
      handlePolarWebhookEvent({
        db,
        chargesEnabled: true,
        products: PRODUCTS,
        payload: {
          type: 'subscription.updated',
          data: {
            id: 'sub_team',
            status: 'past_due',
            product_id: 'prod_team',
            modified_at: '2026-08-09T12:00:00.000Z',
            customer: { id: 'cus_1', external_id: TEAM_ID },
          },
        },
      }),
      handlePolarWebhookEvent({
        db,
        chargesEnabled: true,
        products: PRODUCTS,
        payload: {
          type: 'subscription.updated',
          data: {
            id: 'sub_team',
            status: 'active',
            product_id: 'prod_team',
            modified_at: '2026-08-11T00:00:00.000Z',
            customer: { id: 'cus_1', external_id: TEAM_ID },
          },
        },
      }),
    ]);
    const afterRace = await billing.getAccount();
    expect(afterRace.billingState).toBe('team_active');
    expect(afterRace.polarEventModifiedAt?.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('reverses only the refunded amount of a partial top-up', async () => {
    await enablePrepaidWallet();
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_partial',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.refunded',
        data: {
          id: 'ord_partial',
          product_id: 'prod_topup',
          amount: 1000,
          refunded_amount: 200,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(800);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'refund.created',
        data: {
          id: 'ref_partial',
          order_id: 'ord_partial',
          amount: 200,
          status: 'succeeded',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(800);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'refund.created',
        data: {
          id: 'ref_partial_more',
          order_id: 'ord_partial',
          amount: 300,
          status: 'succeeded',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(500);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.refunded',
        data: {
          id: 'ord_partial',
          product_id: 'prod_topup',
          amount: 1000,
          refunded_amount: 500,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(500);
  });

  it('does not double-debit a partial refund when the refund event arrives first', async () => {
    await enablePrepaidWallet();
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_partial_first',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'refund.created',
        data: {
          id: 'ref_first',
          order_id: 'ord_partial_first',
          amount: 200,
          status: 'succeeded',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.refunded',
        data: {
          id: 'ord_partial_first',
          product_id: 'prod_topup',
          amount: 1000,
          refunded_amount: 200,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(800);
  });

  it('reverses a prepaid top-up when Polar refunds the order', async () => {
    await enablePrepaidWallet();
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_top',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(1000);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'refund.created',
        data: {
          id: 'ref_1',
          order_id: 'ord_top',
          amount: 1000,
          status: 'succeeded',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(0);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.refunded',
        data: {
          id: 'ord_top',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(0);
  });

  it('does not double-debit concurrent refund.created and order.refunded', async () => {
    await enablePrepaidWallet();
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_race',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(1000);
    await Promise.all([
      handlePolarWebhookEvent({
        db,
        chargesEnabled: true,
        products: PRODUCTS,
        payload: {
          type: 'refund.created',
          data: {
            id: 'ref_race',
            order_id: 'ord_race',
            amount: 1000,
            status: 'succeeded',
            customer: { id: 'cus_1', external_id: TEAM_ID },
          },
        },
      }),
      handlePolarWebhookEvent({
        db,
        chargesEnabled: true,
        products: PRODUCTS,
        payload: {
          type: 'order.refunded',
          data: {
            id: 'ord_race',
            product_id: 'prod_topup',
            amount: 1000,
            customer: { id: 'cus_1', external_id: TEAM_ID },
          },
        },
      }),
    ]);
    expect((await billing.getAccount()).walletBalanceCents).toBe(0);
  });

  it('applies an out-of-order top-up refund when the paid event arrives later', async () => {
    await enablePrepaidWallet();
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'refund.created',
        data: {
          id: 'ref_early',
          order_id: 'ord_late',
          amount: 1000,
          status: 'succeeded',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(0);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_late',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).walletBalanceCents).toBe(0);
  });

  it('does not overwrite an Enterprise contract with a self-serve Polar subscription', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active',
          polar_customer_id = 'cus_enterprise'
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_payg',
          status: 'active',
          product_id: 'prod_payg',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const after = await billing.getAccount();
    expect(after.planId).toBe('enterprise');
    expect(after.billingState).toBe('enterprise_active');
    expect(after.polarSubscriptionId).toBeNull();
  });

  it('credits a paid top-up after the subscription is canceled', async () => {
    await enablePrepaidWallet();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET polar_subscription_id = 'sub_payg', wallet_balance_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.canceled',
        data: {
          id: 'sub_payg',
          status: 'canceled',
          product_id: 'prod_payg',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const canceled = await billing.getAccount();
    expect(canceled.planId).toBe('free');
    expect(canceled.billingState).toBe('restricted');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_after_cancel',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_after_cancel',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });

    const after = await billing.getAccount();
    expect(after.planId).toBe('free');
    expect(after.billingState).toBe('restricted');
    expect(after.walletBalanceCents).toBe(1000);
    const ledger = await pg.query<{ kind: string; cents: string }>(
      `SELECT kind, metadata->>'cents' AS cents
       FROM billing_usage_ledger
       WHERE team_id = '${TEAM_ID}' AND operation_id = 'polar_topup:ord_after_cancel'`,
    );
    expect(ledger.rows).toEqual([{ kind: 'top_up', cents: '1000' }]);
  });

  it('credits an already-paid top-up on Enterprise or Free without changing the plan', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active'
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_enterprise',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const enterprise = await billing.getAccount();
    expect(enterprise.planId).toBe('enterprise');
    expect(enterprise.billingState).toBe('enterprise_active');
    expect(enterprise.walletBalanceCents).toBe(1000);

    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'free', billing_state = 'restricted'
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_free',
          product_id: 'prod_topup',
          amount: 1000,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const free = await billing.getAccount();
    expect(free.planId).toBe('free');
    expect(free.billingState).toBe('restricted');
    expect(free.walletBalanceCents).toBe(2000);
  });

  it('rejects a delayed older subscription after a newer one is stored', () => {
    expect(
      shouldApplyPaidSubscriptionUpdate({
        existing: {
          polarSubscriptionId: 'sub_new',
          periodStartedAt: new Date('2026-08-01T00:00:00Z'),
          polarEventModifiedAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
          planId: 'business',
          billingState: 'business_active',
        } as never,
        incomingSubscriptionId: 'sub_old',
        incomingPeriodStartedAt: new Date('2026-07-01T00:00:00Z'),
        incomingModifiedAt: new Date('2026-08-21T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('compares Polar events against the provider clock, not local updatedAt', () => {
    expect(
      shouldApplyPaidSubscriptionUpdate({
        existing: {
          polarSubscriptionId: 'sub_1',
          periodStartedAt: new Date('2026-08-01T00:00:00Z'),
          polarEventModifiedAt: new Date('2026-07-01T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
          planId: 'payg',
          billingState: 'payg_active',
        } as never,
        incomingSubscriptionId: 'sub_1',
        incomingPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        incomingModifiedAt: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toBe(true);
    expect(
      shouldApplyPaidSubscriptionUpdate({
        existing: {
          polarSubscriptionId: 'sub_1',
          periodStartedAt: new Date('2026-08-01T00:00:00Z'),
          polarEventModifiedAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-07-01T00:00:00Z'),
          planId: 'payg',
          billingState: 'payg_active',
        } as never,
        incomingSubscriptionId: 'sub_1',
        incomingPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        incomingModifiedAt: new Date('2026-08-01T00:00:00Z'),
      }),
    ).toBe(false);
  });
});
