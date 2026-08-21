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
  formatEuroFromCents,
  polarEventNameForMeter,
  recallChargeCents,
  storageChargeCents,
} from '#src/billing/catalog.js';
import { verifyPolarWebhookSignature } from '#src/billing/polar.js';
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
  });

  it('prices native meters from the rate card', () => {
    expect(recallChargeCents(10)).toBe(30);
    expect(emailChargeCents(1_000)).toBe(250);
    expect(storageChargeCents(2)).toBe(50);
    expect(acceptedSourcesChargeCents(2_000)).toBe(100);
    expect(OVERAGE_RATES.aiCustomerMultiplier).toBe(4);
    expect(formatEuroFromCents(4_900)).toMatch(/€/);
  });

  it('converts OpenRouter USD cost into customer AI charge cents', () => {
    const { providerCostCents, customerChargeCents } = customerAiChargeCentsFromOpenRouterUsd(1);
    expect(providerCostCents).toBeGreaterThan(0);
    expect(customerChargeCents).toBeGreaterThanOrEqual(providerCostCents * 3);
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

describe('polar webhook signature', () => {
  it('accepts a valid standard-webhooks signature', () => {
    const secretRaw = Buffer.from('test-secret');
    const secret = `whsec_${secretRaw.toString('base64')}`;
    const body = '{"type":"order.paid"}';
    const webhookId = 'msg_1';
    const timestamp = '1710000000';
    const signed = `${webhookId}.${timestamp}.${body}`;
    const signature = createHmac('sha256', secretRaw).update(signed).digest('base64');
    expect(
      verifyPolarWebhookSignature({
        body,
        secret,
        headers: {
          'webhook-id': webhookId,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${signature}`,
        },
      }),
    ).toBe(true);
    expect(
      verifyPolarWebhookSignature({
        body,
        secret,
        headers: {
          'webhook-id': webhookId,
          'webhook-timestamp': timestamp,
          'webhook-signature': 'v1,AAAA',
        },
      }),
    ).toBe(false);
  });
});
