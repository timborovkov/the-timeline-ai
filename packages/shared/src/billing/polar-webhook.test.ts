import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  billingStateFromPolarSubscriptionStatus,
  handlePolarWebhookEvent,
  RETIRED_TOPUP_ALERT_REASON_PREFIX,
  isRetiredPaidTopupOrder,
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
  enterprise: 'prod_enterprise',
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
    expect(billingStateFromPolarSubscriptionStatus('enterprise', 'active')).toBe(
      'enterprise_active',
    );
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

  it('does not let a Polar subscription overwrite a comped plan', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', plan_id = 'team', billing_state = 'team_active',
          spend_cap_cents = 2500, comp_reason = 'internal'
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_comp',
          status: 'active',
          product_id: 'prod_business',
          customer: { id: 'cus_comp', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.arrangement).toBe('comped');
    expect(account.planId).toBe('team');
    expect(account.spendCapCents).toBe(2500);
    expect(account.polarSubscriptionId).toBeNull();
  });

  it('does not let a Team subscription downgrade an Enterprise contract', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active', spend_cap_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_team',
          status: 'active',
          product_id: 'prod_team',
          customer: { id: 'cus_team', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.planId).toBe('enterprise');
    expect(account.billingState).toBe('enterprise_active');
    expect(account.polarSubscriptionId).toBeNull();
  });

  it('attaches an Enterprise subscription onto an operator-prepared team', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'enterprise', billing_state = 'enterprise_active', spend_cap_cents = 80000,
          price_override = '{"platformFeeCents":250000}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_enterprise',
          status: 'active',
          product_id: 'prod_enterprise',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.planId).toBe('enterprise');
    expect(account.billingState).toBe('enterprise_active');
    expect(account.polarSubscriptionId).toBe('sub_enterprise');
    expect(account.polarProductId).toBe('prod_enterprise');
    expect(account.polarCustomerId).toBe('cus_enterprise');
    expect(account.spendCapCents).toBe(80000);
    expect(account.priceOverride).toMatchObject({ platformFeeCents: 250000 });
  });

  it('activates pending Enterprise terms from the paid subscription webhook', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', spend_cap_cents = 2500,
          pending_enterprise_terms = '{"platformFeeCents":250000,"includedActiveMembers":12,"spendCapCents":80000}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_enterprise',
          status: 'active',
          product_id: 'prod_enterprise',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.planId).toBe('enterprise');
    expect(account.billingState).toBe('enterprise_active');
    expect(account.polarSubscriptionId).toBe('sub_enterprise');
    expect(account.spendCapCents).toBe(80000);
    expect(account.pendingEnterpriseTerms).toBeNull();
    expect(account.priceOverride).toEqual({
      platformFeeCents: 250000,
      includedActiveMembers: 12,
    });
    expect(account.priceOverrideExpiresAt).toBeNull();
  });

  it('activates only the Enterprise checkout that Polar says was paid', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', spend_cap_cents = 2500,
          pending_enterprise_terms = '{"byCheckoutId":{"chk_early":{"platformFeeCents":100000,"spendCapCents":40000},"chk_later":{"platformFeeCents":250000,"includedActiveMembers":12,"spendCapCents":80000}}}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_early',
          status: 'active',
          product_id: 'prod_enterprise',
          checkout_id: 'chk_early',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.planId).toBe('enterprise');
    expect(account.spendCapCents).toBe(40000);
    expect(account.priceOverride).toEqual({ platformFeeCents: 100000 });
    expect(account.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_later: {
          platformFeeCents: 250000,
          includedActiveMembers: 12,
          spendCapCents: 80000,
        },
      },
    });
  });

  it('does not apply another Enterprise checkout when the paid event names a different one', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active', spend_cap_cents = 2500,
          pending_enterprise_terms = '{"byCheckoutId":{"chk_later":{"platformFeeCents":250000,"spendCapCents":80000}}}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_other',
          status: 'active',
          product_id: 'prod_enterprise',
          checkout_id: 'chk_early',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.planId).toBe('enterprise');
    expect(account.spendCapCents).toBe(2500);
    expect(account.priceOverride).toBeNull();
    expect(account.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_later: { platformFeeCents: 250000, spendCapCents: 80000 },
      },
    });
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
    const notices = await pg.query<{ subject: string }>(
      `SELECT subject FROM message_deliveries WHERE metadata->>'billing_alert_kind' = 'subscription_past_due'`,
    );
    expect(notices.rows.map((row) => row.subject)).toEqual([
      'Polar Hook: subscription payment failed',
    ]);
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
          modified_at: '2099-01-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const retried = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM message_deliveries WHERE metadata->>'billing_alert_kind' = 'subscription_past_due'`,
    );
    expect(Number(retried.rows[0]?.n)).toBe(1);
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

  it('recognizes a retired top-up and ignores a subscription order', () => {
    expect(
      isRetiredPaidTopupOrder({
        products: PRODUCTS,
        data: { product: { name: 'Timeline Top-up' }, amount: 1000 },
      }),
    ).toBe(true);
    expect(
      isRetiredPaidTopupOrder({
        products: { ...PRODUCTS, topup: 'prod_retired' },
        data: { product_id: 'prod_retired', amount: 1000 },
      }),
    ).toBe(true);
    expect(
      isRetiredPaidTopupOrder({
        products: PRODUCTS,
        data: { product_id: 'prod_unknown', billing_reason: 'purchase', amount: 2500 },
      }),
    ).toBe(true);
    expect(
      isRetiredPaidTopupOrder({
        products: PRODUCTS,
        data: { product_id: 'prod_payg', billing_reason: 'subscription_cycle', amount: 0 },
      }),
    ).toBe(false);
  });

  it('records a stray paid top-up and alerts without crediting a balance', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'free', billing_state = 'restricted', wallet_balance_cents = 0
      WHERE team_id = '${TEAM_ID}';
    `);
    const payload = {
      type: 'order.paid',
      data: {
        id: 'ord_stray',
        amount: 1000,
        product: { name: 'Timeline Top-up', is_recurring: false },
        customer: { id: 'cus_1', external_id: TEAM_ID },
      },
    };
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload,
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload,
    });

    const account = await billing.getAccount();
    expect(account.planId).toBe('free');
    expect(account.billingState).toBe('restricted');
    expect(account.walletBalanceCents).toBe(0);
    const ledger = await pg.query<{ kind: string; cents: string; credited: string }>(
      `SELECT kind, metadata->>'cents' AS cents, metadata->>'wallet_credited' AS credited
       FROM billing_usage_ledger
       WHERE team_id = '${TEAM_ID}' AND operation_id = 'polar_topup:ord_stray'`,
    );
    expect(ledger.rows).toEqual([{ kind: 'top_up', cents: '1000', credited: 'false' }]);
    const alerts = await pg.query<{ reason: string; meter_id: string }>(
      `SELECT reason, meter_id FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toEqual([
      { reason: `${RETIRED_TOPUP_ALERT_REASON_PREFIX}ord_stray`, meter_id: 'top_up' },
    ]);

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'order.paid',
        data: {
          id: 'ord_subscription',
          product_id: 'prod_payg',
          billing_reason: 'subscription_cycle',
          amount: 0,
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const subscriptionOrders = await pg.query<{ id: string }>(
      `SELECT id FROM billing_usage_ledger
       WHERE team_id = '${TEAM_ID}' AND operation_id = 'polar_topup:ord_subscription'`,
    );
    expect(subscriptionOrders.rows).toEqual([]);
  });
});
