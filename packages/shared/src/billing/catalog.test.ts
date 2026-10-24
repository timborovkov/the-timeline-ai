import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BILLING_ENTITLEMENTS_VERSION,
  FREE_ALLOWANCES,
  OVERAGE_RATES,
  PLAN_CATALOG,
  PUBLIC_PLAN_ORDER,
  SELF_SERVE_PLAN_ORDER,
  acceptedSourcesChargeCents,
  customerAiChargeCentsFromOpenRouterUsd,
  emailChargeCents,
  emailRecipientCount,
  formatEuroFromCents,
  polarEventNameForMeter,
  planUsesPrepaidWallet,
  ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
  BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
  MEETING_MAX_DURATION_MINUTES_BY_PLAN,
  PREPAID_TOPUP_CENTS,
  recallChargeCents,
  storageChargeCents,
} from '#src/billing/catalog.js';
import {
  createPlanChangeSession,
  polarSubscriptionIdForPlanChange,
  verifyPolarWebhookSignature,
} from '#src/billing/polar.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';

describe('billing catalog', () => {
  it('exposes the v1 commercial journey in public order', () => {
    expect(BILLING_ENTITLEMENTS_VERSION).toBe('v1');
    expect(PUBLIC_PLAN_ORDER).toEqual(['free', 'payg', 'team', 'business', 'enterprise']);
    expect(SELF_SERVE_PLAN_ORDER).toEqual(['free', 'payg', 'team', 'business']);
    expect(PLAN_CATALOG.free.platformFeeCents).toBe(0);
    expect(PLAN_CATALOG.payg.platformFeeCents).toBe(0);
    expect(PLAN_CATALOG.team.platformFeeCents).toBe(4_900);
    expect(PLAN_CATALOG.business.platformFeeCents).toBe(19_900);
    expect(PLAN_CATALOG.team.includedUsageDiscountCents).toBe(6_000);
    expect(PLAN_CATALOG.business.includedUsageDiscountCents).toBe(25_000);
    expect(FREE_ALLOWANCES.aiChargeCents).toBe(500);
    expect(FREE_ALLOWANCES.recallMinutes).toBe(60);
    expect(ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS).toBe(250);
    expect(MEETING_MAX_DURATION_MINUTES_BY_PLAN.free).toBe(120);
    expect(MEETING_MAX_DURATION_MINUTES_BY_PLAN.payg).toBe(240);
    expect(planUsesPrepaidWallet('payg')).toBe(true);
    expect(planUsesPrepaidWallet('team')).toBe(true);
    expect(planUsesPrepaidWallet('business')).toBe(true);
    expect(planUsesPrepaidWallet('enterprise')).toBe(false);
    expect(planUsesPrepaidWallet('free')).toBe(false);
  });

  it('prices native meters from the rate card', () => {
    expect(recallChargeCents(10)).toBe(30);
    expect(emailChargeCents(1_000)).toBe(250);
    expect(emailRecipientCount('a@x.test, b@y.test')).toBe(2);
    expect(PREPAID_TOPUP_CENTS).toBe(1_000);
    expect(BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS).toBe(100);
    expect(storageChargeCents(2)).toBe(50);
    expect(acceptedSourcesChargeCents(2_000)).toBe(100);
    expect(OVERAGE_RATES.aiCustomerMultiplier).toBe(4);
    expect(formatEuroFromCents(4_900)).toMatch(/€/);
  });

  it('converts OpenRouter USD cost into customer AI charge cents', () => {
    const { providerCostCents, customerChargeCents } = customerAiChargeCentsFromOpenRouterUsd(1);
    expect(providerCostCents).toBe(92);
    expect(customerChargeCents).toBe(368);
    expect(polarEventNameForMeter('ai')).toBe('timeline_ai_eur_cents');
    expect(polarEventNameForMeter('member_days')).toBeNull();
  });
});

describe('fake billing provider', () => {
  it('records ingested usage events', async () => {
    const provider = createFakeBillingProvider();
    const customer = await provider.ensureCustomer({
      externalId: 'team-1',
      email: 'owner@example.com',
    });
    expect(customer.id).toMatch(/^cus_fake_/);
    await provider.ingestUsage({
      externalCustomerId: 'team-1',
      name: 'timeline_ai_eur_cents',
      units: 12,
    });
    expect(provider.events).toHaveLength(1);
    expect(provider.events[0]?.units).toBe(12);
  });
});

describe('paid plan change', () => {
  it('updates the existing Polar subscription instead of opening a second checkout', async () => {
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'team',
        billingState: 'team_active',
        polarSubscriptionId: 'sub_paid',
      }),
    ).toBe('sub_paid');
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'free',
        billingState: 'free',
        polarSubscriptionId: null,
      }),
    ).toBeUndefined();
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'payg',
        billingState: 'past_due',
        polarSubscriptionId: 'sub_paid',
      }),
    ).toBe('sub_paid');
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'team',
        billingState: 'payment_retry',
        polarSubscriptionId: 'sub_paid',
      }),
    ).toBe('sub_paid');
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'business',
        billingState: 'read_only',
        polarSubscriptionId: 'sub_paid',
      }),
    ).toBe('sub_paid');
    expect(
      polarSubscriptionIdForPlanChange({
        planId: 'payg',
        billingState: 'canceled',
        polarSubscriptionId: 'sub_paid',
      }),
    ).toBeUndefined();

    const provider = createFakeBillingProvider();
    const updated = await createPlanChangeSession({
      provider,
      account: {
        planId: 'payg',
        billingState: 'payg_active',
        polarSubscriptionId: 'sub_paid',
      },
      productId: 'prod_team',
      externalCustomerId: 'team-1',
      customerEmail: 'owner@example.test',
      successUrl: 'https://timeline.test/app/team?section=billing&checkout=success',
      portalReturnUrl: 'https://timeline.test/app/team?section=billing',
    });
    expect(updated.url).toContain('checkout=success');
    expect(provider.subscriptionUpdates).toEqual([
      { subscriptionId: 'sub_paid', productId: 'prod_team' },
    ]);

    const fresh = createFakeBillingProvider();
    const checkout = await createPlanChangeSession({
      provider: fresh,
      account: { planId: 'free', billingState: 'free', polarSubscriptionId: null },
      productId: 'prod_payg',
      externalCustomerId: 'team-1',
      customerEmail: 'owner@example.test',
      successUrl: 'https://timeline.test/success',
      portalReturnUrl: 'https://timeline.test/portal',
    });
    expect(checkout.url).toContain('/checkout/fake');
    expect(fresh.subscriptionUpdates).toHaveLength(0);
  });

  it('sends the owner to the Polar portal when the subscription cannot be patched', async () => {
    const provider = createFakeBillingProvider();
    provider.updateSubscription = () => Promise.resolve({ ok: false, code: 'portal_required' });
    const result = await createPlanChangeSession({
      provider,
      account: {
        planId: 'team',
        billingState: 'team_active',
        polarSubscriptionId: 'sub_paid',
      },
      productId: 'prod_business',
      externalCustomerId: 'team-1',
      customerEmail: 'owner@example.test',
      successUrl: 'https://timeline.test/success',
      portalReturnUrl: 'https://timeline.test/portal',
    });
    expect(result.url).toContain('/portal/fake');
  });

  it('refuses self-serve checkout for Enterprise contracts', async () => {
    const provider = createFakeBillingProvider();
    await expect(
      createPlanChangeSession({
        provider,
        account: {
          planId: 'enterprise',
          billingState: 'enterprise_active',
          polarSubscriptionId: 'sub_enterprise',
        },
        productId: 'prod_team',
        externalCustomerId: 'team-1',
        customerEmail: 'owner@example.test',
        successUrl: 'https://timeline.test/success',
        portalReturnUrl: 'https://timeline.test/portal',
      }),
    ).rejects.toThrow(/Enterprise plan changes/);
    expect(provider.subscriptionUpdates).toHaveLength(0);
  });
});

describe('polar webhook signature', () => {
  function signedRequest(timestamp: string) {
    const secretRaw = Buffer.from('test-secret');
    const secret = `whsec_${secretRaw.toString('base64')}`;
    const body = '{"type":"order.paid"}';
    const webhookId = 'msg_1';
    const signed = `${webhookId}.${timestamp}.${body}`;
    const signature = createHmac('sha256', secretRaw).update(signed).digest('base64');
    return {
      body,
      secret,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      },
    };
  }

  it('accepts a valid standard-webhooks signature', () => {
    const now = new Date('2026-08-26T17:00:00.000Z');
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const request = signedRequest(timestamp);
    expect(verifyPolarWebhookSignature({ ...request, now })).toBe(true);
    expect(
      verifyPolarWebhookSignature({
        ...request,
        now,
        headers: { ...request.headers, 'webhook-signature': 'v1,AAAA' },
      }),
    ).toBe(false);
  });

  it('rejects stale or far-future webhook timestamps', () => {
    const now = new Date('2026-08-26T17:00:00.000Z');
    const stale = String(Math.floor(now.getTime() / 1000) - 10 * 60);
    const future = String(Math.floor(now.getTime() / 1000) + 10 * 60);
    expect(verifyPolarWebhookSignature({ ...signedRequest(stale), now })).toBe(false);
    expect(verifyPolarWebhookSignature({ ...signedRequest(future), now })).toBe(false);
  });
});
