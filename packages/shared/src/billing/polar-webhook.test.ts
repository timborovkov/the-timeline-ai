import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  billingStateFromPolarSubscriptionStatus,
  handlePolarWebhookEvent,
  shouldResetIncludedDiscount,
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
        existing: existing as never,
        planId: 'business',
        polarSubscriptionId: 'sub_1',
        periodEndsAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ).toBe(true);
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
    expect(canceled.billingState).toBe('canceled');
  });
});
