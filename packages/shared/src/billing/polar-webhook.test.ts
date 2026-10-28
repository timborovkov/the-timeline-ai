import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import {
  billingStateForPolarSubscriptionUpsert,
  billingStateFromPolarSubscriptionStatus,
  COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX,
  DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX,
  applyElapsedScheduledCancellations,
  handlePolarWebhookEvent,
  RETIRED_TOPUP_ALERT_REASON_PREFIX,
  isRetiredPaidTopupOrder,
  shouldApplyPaidSubscriptionUpdate,
  shouldResetIncludedDiscount,
  spendCapCentsForPaidActivation,
} from '#src/billing/polar-webhook.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
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
  it('keeps a local spend-cap freeze when Polar reports an active subscription', () => {
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'read_only',
        outstandingDebtCents: 400,
      }),
    ).toBe('read_only');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'balance_exhausted',
        outstandingDebtCents: 400,
      }),
    ).toBe('balance_exhausted');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'team_active',
        outstandingDebtCents: 400,
      }),
    ).toBe('read_only');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'past_due',
        existingState: 'read_only',
        outstandingDebtCents: 400,
      }),
    ).toBe('past_due');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'read_only',
        outstandingDebtCents: 0,
      }),
    ).toBe('team_active');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'read_only',
        outstandingDebtCents: 0,
        preserveLocalFreeze: true,
      }),
    ).toBe('read_only');
    expect(
      billingStateForPolarSubscriptionUpsert({
        incoming: 'team_active',
        existingState: 'past_due',
        outstandingDebtCents: 0,
        preserveLocalFreeze: true,
      }),
    ).toBe('team_active');
  });

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
    expect(account.billingState).toBe('team_active');
    expect(account.polarSubscriptionId).toBe('sub_comp');
    const alerts = await pg.query<{ detail: string }>(
      `SELECT detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND reason = '${COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_comp'`,
    );
    expect(alerts.rows[0]?.detail).toContain('still billing');
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
    expect(account.enterprisePlatformFeeCents).toBe(250000);
    expect(account.priceOverride).toEqual({
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
    expect(account.enterprisePlatformFeeCents).toBe(100000);
    expect(account.priceOverride).toBeNull();
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
    expect(account.enterprisePlatformFeeCents).toBeNull();
    expect(account.priceOverride).toBeNull();
    expect(account.pendingEnterpriseTerms).toEqual({
      byCheckoutId: {
        chk_later: { platformFeeCents: 250000, spendCapCents: 80000 },
      },
    });
  });

  it('revokes the previous live subscription when a second Enterprise subscription activates', async () => {
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
          polar_subscription_id = 'sub_old', polar_product_id = 'prod_enterprise',
          period_started_at = '2026-01-01T00:00:00Z',
          polar_event_modified_at = '2026-01-01T00:00:00Z',
          pending_enterprise_terms = '{"byCheckoutId":{"chk_new":{"platformFeeCents":250000,"spendCapCents":80000}}}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const provider = createFakeBillingProvider();
    const payload = {
      type: 'subscription.active',
      data: {
        id: 'sub_new',
        status: 'active',
        product_id: 'prod_enterprise',
        checkout_id: 'chk_new',
        current_period_start: '2026-06-01T00:00:00.000Z',
        modified_at: '2026-06-01T00:00:00.000Z',
        customer: { id: 'cus_enterprise', external_id: TEAM_ID },
      },
    };
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload,
    });
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload,
    });
    const account = await billing.getAccount();
    expect(account.polarSubscriptionId).toBe('sub_new');
    expect(account.enterprisePlatformFeeCents).toBe(250000);
    expect(provider.revokedSubscriptionIds).toEqual(['sub_old']);
    const alerts = await pg.query<{ reason: string; detail: string }>(
      `SELECT reason, detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]?.reason).toBe(`${DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_old`);
    expect(alerts.rows[0]?.detail).toContain('sub_old');
    expect(alerts.rows[0]?.detail).toContain('revoked');
  });

  it('alerts when the extra subscription cannot be revoked and leaves a canceled id alone', async () => {
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
          polar_subscription_id = 'sub_old', polar_product_id = 'prod_enterprise',
          period_started_at = '2026-01-01T00:00:00Z',
          polar_event_modified_at = '2026-01-01T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const provider = createFakeBillingProvider();
    provider.revokeSubscription = () => Promise.reject(new Error('polar down'));
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_new',
          status: 'active',
          product_id: 'prod_enterprise',
          current_period_start: '2026-06-01T00:00:00.000Z',
          modified_at: '2026-06-01T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const replaced = await billing.getAccount();
    expect(replaced.polarSubscriptionId).toBe('sub_new');
    expect(provider.revokedSubscriptionIds).toEqual([]);
    const failed = await pg.query<{ detail: string }>(
      `SELECT detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0]?.detail).toContain('sub_old');
    expect(failed.rows[0]?.detail).toContain('still billing');

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
          current_period_start: '2026-07-01T00:00:00.000Z',
          modified_at: '2026-07-01T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const unrevoked = await billing.getAccount();
    expect(unrevoked.polarSubscriptionId).toBe('sub_other');
    const missingProvider = await pg.query<{ reason: string; detail: string }>(
      `SELECT reason, detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL
       ORDER BY reason`,
    );
    expect(missingProvider.rows.map((row) => row.reason)).toEqual([
      `${DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_new`,
      `${DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_old`,
    ]);
    expect(missingProvider.rows[0]?.detail).toContain('still billing');
    expect(missingProvider.rows[0]?.detail).toContain('sub_new');

    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'canceled', polar_subscription_id = 'sub_canceled',
          period_started_at = '2026-01-01T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const before = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM billing_unbilled_alerts WHERE team_id = '${TEAM_ID}'`,
    );
    const canceledProvider = createFakeBillingProvider();
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider: canceledProvider,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_after_cancel',
          status: 'active',
          product_id: 'prod_enterprise',
          current_period_start: '2026-08-01T00:00:00.000Z',
          modified_at: '2026-08-01T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const afterCancel = await billing.getAccount();
    expect(afterCancel.polarSubscriptionId).toBe('sub_after_cancel');
    expect(canceledProvider.revokedSubscriptionIds).toEqual([]);
    const after = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM billing_unbilled_alerts WHERE team_id = '${TEAM_ID}'`,
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('revokes a newer checkout that loses to the subscription already tracked', async () => {
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
          polar_subscription_id = 'sub_kept', polar_product_id = 'prod_enterprise',
          period_started_at = '2026-06-01T00:00:00Z',
          polar_event_modified_at = '2026-06-01T00:00:00Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const provider = createFakeBillingProvider();
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_late',
          status: 'active',
          product_id: 'prod_enterprise',
          current_period_start: '2026-01-01T00:00:00.000Z',
          modified_at: '2026-07-01T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const account = await billing.getAccount();
    expect(account.polarSubscriptionId).toBe('sub_kept');
    expect(provider.revokedSubscriptionIds).toEqual(['sub_late']);
    const alerts = await pg.query<{ reason: string; detail: string }>(
      `SELECT reason, detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]?.reason).toBe(`${DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_late`);
    expect(alerts.rows[0]?.detail).toContain('sub_kept');
    expect(alerts.rows[0]?.detail).toContain('revoked');
  });

  it('revokes a subscription that arrives after the workspace is comped', async () => {
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
          spend_cap_cents = 2500, comp_reason = 'internal',
          pending_enterprise_terms = '{"byCheckoutId":{"chk_paid":{"platformFeeCents":250000,"spendCapCents":80000},"chk_other":{"platformFeeCents":100000}}}'::jsonb
      WHERE team_id = '${TEAM_ID}';
    `);
    const provider = createFakeBillingProvider();
    const payload = {
      type: 'subscription.active',
      data: {
        id: 'sub_after_comp',
        status: 'active',
        product_id: 'prod_enterprise',
        checkout_id: 'chk_paid',
        customer: { id: 'cus_comp', external_id: TEAM_ID },
      },
    };
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload,
    });
    const account = await billing.getAccount();
    expect(account.arrangement).toBe('comped');
    expect(account.planId).toBe('team');
    expect(account.spendCapCents).toBe(2500);
    expect(account.enterprisePlatformFeeCents).toBeNull();
    expect(account.polarSubscriptionId).toBeNull();
    expect(account.pendingEnterpriseTerms).toEqual({
      byCheckoutId: { chk_other: { platformFeeCents: 100000 } },
    });
    expect(provider.revokedSubscriptionIds).toEqual(['sub_after_comp']);
    const alerts = await pg.query<{ reason: string; detail: string }>(
      `SELECT reason, detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND resolved_at IS NULL`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]?.reason).toBe(
      `${COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_after_comp`,
    );
    expect(alerts.rows[0]?.detail).toContain('revoked');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload,
    });
    const replayed = await billing.getAccount();
    expect(replayed.arrangement).toBe('comped');
    expect(replayed.planId).toBe('team');
    expect(replayed.polarSubscriptionId).toBeNull();
    expect(provider.revokedSubscriptionIds).toEqual(['sub_after_comp', 'sub_after_comp']);
  });

  it('stores the incoming subscription when a comped workspace cannot revoke it', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET arrangement = 'comped', plan_id = 'enterprise', billing_state = 'enterprise_active',
          spend_cap_cents = 0, comp_reason = 'internal',
          polar_subscription_id = 'sub_stuck'
      WHERE team_id = '${TEAM_ID}';
    `);
    const provider = createFakeBillingProvider();
    provider.revokeSubscription = () => Promise.reject(new Error('polar down'));
    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      provider,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_new_comp',
          status: 'active',
          product_id: 'prod_enterprise',
          customer: { id: 'cus_comp', external_id: TEAM_ID },
        },
      },
    });
    const kept = await billing.getAccount();
    expect(kept.arrangement).toBe('comped');
    expect(kept.planId).toBe('enterprise');
    expect(kept.polarSubscriptionId).toBe('sub_stuck');
    const failed = await pg.query<{ detail: string }>(
      `SELECT detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND reason = '${COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_new_comp'`,
    );
    expect(failed.rows[0]?.detail).toContain('still billing');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.active',
        data: {
          id: 'sub_stuck',
          status: 'active',
          product_id: 'prod_enterprise',
          customer: { id: 'cus_comp', external_id: TEAM_ID },
        },
      },
    });
    const stored = await billing.getAccount();
    expect(stored.polarSubscriptionId).toBe('sub_stuck');
    expect(stored.arrangement).toBe('comped');
    const missingProvider = await pg.query<{ detail: string }>(
      `SELECT detail FROM billing_unbilled_alerts
       WHERE team_id = '${TEAM_ID}' AND reason = '${COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX}sub_stuck'`,
    );
    expect(missingProvider.rows[0]?.detail).toContain('still billing');
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
    expect(canceled.polarSubscriptionId).toBeNull();
    expect(canceled.polarProductId).toBeNull();

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

  it('keeps paid access until a period-end cancel takes effect', async () => {
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
        type: 'subscription.active',
        data: {
          id: 'sub_period',
          status: 'active',
          product_id: 'prod_business',
          current_period_end: '2099-02-01T00:00:00.000Z',
          modified_at: '2099-01-01T00:00:00.000Z',
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
          id: 'sub_period',
          status: 'active',
          product_id: 'prod_business',
          cancel_at_period_end: true,
          ends_at: '2099-02-01T00:00:00.000Z',
          current_period_end: '2099-02-01T00:00:00.000Z',
          modified_at: '2099-01-02T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const scheduled = await billing.getAccount();
    expect(scheduled.planId).toBe('business');
    expect(scheduled.billingState).toBe('business_active');
    expect(scheduled.polarSubscriptionId).toBe('sub_period');
    expect(scheduled.cancelEffectiveAt?.toISOString()).toBe('2099-02-01T00:00:00.000Z');

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_period',
          status: 'canceled',
          product_id: 'prod_business',
          cancel_at_period_end: true,
          ends_at: '2099-02-01T00:00:00.000Z',
          modified_at: '2099-01-03T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const stillPaid = await billing.getAccount();
    expect(stillPaid.planId).toBe('business');
    expect(stillPaid.polarSubscriptionId).toBe('sub_period');

    expect(await applyElapsedScheduledCancellations(db, new Date('2099-01-15T00:00:00.000Z'))).toBe(
      0,
    );
    expect((await billing.getAccount()).planId).toBe('business');

    expect(await applyElapsedScheduledCancellations(db, new Date('2099-02-01T00:00:00.000Z'))).toBe(
      1,
    );
    const ended = await billing.getAccount();
    expect(ended.planId).toBe('free');
    expect(ended.billingState).toBe('restricted');
    expect(ended.polarSubscriptionId).toBeNull();
    expect(ended.cancelEffectiveAt).toBeNull();
  });

  it('downgrades on subscription.revoked while a period-end cancel is still scheduled', async () => {
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
        type: 'subscription.active',
        data: {
          id: 'sub_revoke',
          status: 'active',
          product_id: 'prod_team',
          modified_at: '2099-03-01T00:00:00.000Z',
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
          id: 'sub_revoke',
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: '2099-04-01T00:00:00.000Z',
          modified_at: '2099-03-02T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).planId).toBe('team');
    expect((await billing.getAccount()).cancelEffectiveAt?.toISOString()).toBe(
      '2099-04-01T00:00:00.000Z',
    );

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.revoked',
        data: {
          id: 'sub_revoke',
          status: 'revoked',
          ends_at: '2099-04-01T00:00:00.000Z',
          modified_at: '2099-03-03T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const revoked = await billing.getAccount();
    expect(revoked.planId).toBe('free');
    expect(revoked.billingState).toBe('restricted');
    expect(revoked.polarSubscriptionId).toBeNull();
    expect(revoked.cancelEffectiveAt).toBeNull();
  });

  it('clears a scheduled cancel when Polar reports the subscription active again', async () => {
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
        type: 'subscription.active',
        data: {
          id: 'sub_keep',
          status: 'active',
          product_id: 'prod_payg',
          modified_at: '2099-05-01T00:00:00.000Z',
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
          id: 'sub_keep',
          cancel_at_period_end: true,
          ends_at: '2099-06-01T00:00:00.000Z',
          modified_at: '2099-05-02T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).cancelEffectiveAt).not.toBeNull();

    await handlePolarWebhookEvent({
      db,
      chargesEnabled: true,
      products: PRODUCTS,
      payload: {
        type: 'subscription.updated',
        data: {
          id: 'sub_keep',
          status: 'active',
          product_id: 'prod_payg',
          cancel_at_period_end: false,
          ends_at: null,
          modified_at: '2099-05-03T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const resumed = await billing.getAccount();
    expect(resumed.planId).toBe('payg');
    expect(resumed.billingState).toBe('payg_active');
    expect(resumed.polarSubscriptionId).toBe('sub_keep');
    expect(resumed.cancelEffectiveAt).toBeNull();
  });

  it('does not downgrade when an uncancel lands before the sweep locks the account', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active',
          polar_subscription_id = 'sub_resume',
          cancel_effective_at = '2099-06-01T00:00:00.000Z',
          polar_event_modified_at = '2099-05-02T00:00:00.000Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const applied = await applyElapsedScheduledCancellations(
      db,
      new Date('2099-06-02T00:00:00.000Z'),
      {
        afterSelect: async () => {
          await pg.exec(`
            UPDATE team_billing_accounts
            SET cancel_effective_at = NULL,
                polar_event_modified_at = '2099-06-02T00:00:00.000Z'
            WHERE team_id = '${TEAM_ID}';
          `);
        },
      },
    );
    expect(applied).toBe(0);
    const kept = await billing.getAccount();
    expect(kept.planId).toBe('payg');
    expect(kept.billingState).toBe('payg_active');
    expect(kept.polarSubscriptionId).toBe('sub_resume');
    expect(kept.cancelEffectiveAt).toBeNull();
  });

  it('does not downgrade when the locked cancel is no longer due', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'team', billing_state = 'team_active',
          polar_subscription_id = 'sub_later',
          cancel_effective_at = '2099-07-01T00:00:00.000Z'
      WHERE team_id = '${TEAM_ID}';
    `);
    const applied = await applyElapsedScheduledCancellations(
      db,
      new Date('2099-07-02T00:00:00.000Z'),
      {
        afterSelect: async () => {
          await pg.exec(`
            UPDATE team_billing_accounts
            SET cancel_effective_at = '2099-08-01T00:00:00.000Z'
            WHERE team_id = '${TEAM_ID}';
          `);
        },
      },
    );
    expect(applied).toBe(0);
    const kept = await billing.getAccount();
    expect(kept.planId).toBe('team');
    expect(kept.polarSubscriptionId).toBe('sub_later');
    expect(kept.cancelEffectiveAt?.toISOString()).toBe('2099-08-01T00:00:00.000Z');
  });

  it('drops a canceled Enterprise contract before a later self-serve plan', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.getAccount();
    await pg.exec(`
      UPDATE team_billing_accounts
      SET plan_id = 'payg', billing_state = 'payg_active',
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
          modified_at: '2026-08-01T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
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
          id: 'sub_enterprise',
          product_id: 'prod_enterprise',
          modified_at: '2026-08-02T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const canceled = await billing.getAccount();
    expect(canceled.planId).toBe('free');
    expect(canceled.polarSubscriptionId).toBeNull();
    expect(canceled.polarProductId).toBeNull();
    expect(canceled.enterprisePlatformFeeCents).toBeNull();
    expect(canceled.priceOverride).toBeNull();
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
          modified_at: '2026-08-03T00:00:00.000Z',
          customer: { id: 'cus_enterprise', external_id: TEAM_ID },
        },
      },
    });
    const dash = await billing.getDashboard();
    expect(dash.plan.id).toBe('payg');
    expect(dash.account.enterprisePlatformFeeCents).toBeNull();
    expect(dash.planPreview.bills.payg.platformFeeCents).toBe(0);
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

  it('keeps a spend-cap freeze across an active renewal and restores it when the cap is raised', async () => {
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
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
          modified_at: '2026-08-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'read_only', spend_cap_cents = 0,
          included_discount_remaining_cents = 12
      WHERE team_id = '${TEAM_ID}';
      INSERT INTO billing_usage_ledger (
        team_id, operation_id, kind, meter_id, native_units, customer_charge_cents,
        billable, non_billable_reason, operation_class, metadata
      ) VALUES (
        '${TEAM_ID}', 'refund-shortfall', 'reversal', 'ai', 0, 0,
        false, 'wallet_refund', 'wallet_refund',
        '{"cents":1000,"wallet_shortfall_cents":400}'::jsonb
      );
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
          id: 'sub_team',
          status: 'active',
          product_id: 'prod_team',
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
          modified_at: '2026-09-01T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    const renewed = await billing.getAccount();
    expect(renewed.billingState).toBe('read_only');
    expect(renewed.spendCapCents).toBe(0);
    expect(renewed.includedDiscountRemainingCents).toBe(6_000);
    const blocked = await billing.reserve({
      operationId: 'op-while-frozen',
      meterId: 'ai',
      reservedNativeUnits: 20,
      reservedChargeCents: 20,
    });
    expect(blocked.ok).toBe(false);
    const raised = await billing.setSpendCap(10_000);
    expect(raised.billingState).toBe('team_active');
    expect(raised.spendCapCents).toBe(10_000);

    await pg.exec(`
      UPDATE team_billing_accounts SET billing_state = 'team_active' WHERE team_id = '${TEAM_ID}';
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
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
          modified_at: '2026-09-02T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).billingState).toBe('team_active');

    await pg.exec(`
      UPDATE team_billing_accounts
      SET billing_state = 'past_due', polar_event_modified_at = '2026-09-02T00:00:00.000Z'
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
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
          modified_at: '2026-09-03T00:00:00.000Z',
          customer: { id: 'cus_1', external_id: TEAM_ID },
        },
      },
    });
    expect((await billing.getAccount()).billingState).toBe('team_active');
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
