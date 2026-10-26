import { describe, expect, it } from 'vitest';

import { OVERAGE_RATES, PLAN_CATALOG } from '#src/billing/catalog.js';
import {
  DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
  TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS,
  TIMELINE_METERED_EVENT_NAMES,
  TIMELINE_METERED_UNIT_AMOUNTS,
  TIMELINE_METER_SPECS,
  TIMELINE_POLAR_WEBHOOK_EVENTS,
  TIMELINE_PRODUCT_KEYS,
  TIMELINE_TOPUP_PRODUCT_NAME,
  assertPolarSetupServer,
  assertTimelineWebhookUrl,
  planPolarSetup,
  renderPolarSetupReport,
  runPolarSetup,
  type PolarMeterWrite,
  type PolarPriceWrite,
  type PolarProductPatch,
  type PolarProductWrite,
  type PolarSetupClient,
  type PolarSetupDiscount,
  type PolarSetupMeter,
  type PolarSetupPrice,
  type PolarSetupProduct,
  type PolarSetupRequest,
  type PolarSetupSnapshot,
  type PolarSetupWebhook,
  type PolarWebhookWrite,
  type TimelineProductKey,
} from '#src/billing/polar-setup.js';

const request: PolarSetupRequest = {
  webhookUrl: DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
  webhookId: null,
  discountCode: null,
  preferredProductIds: {},
};

function meter(spec: (typeof TIMELINE_METER_SPECS)[number]): PolarSetupMeter {
  return {
    id: `meter-${spec.key}`,
    name: spec.name,
    eventName: spec.eventName,
    metadata: { timeline_key: spec.key },
    archived: false,
  };
}

function productPrices(key: TimelineProductKey): PolarSetupPrice[] {
  const platform: PolarSetupPrice =
    key === 'enterprise'
      ? {
          id: `${key}-fee`,
          archived: false,
          meterId: null,
          amountType: 'custom',
          priceAmount: null,
          priceCurrency: 'eur',
          minimumAmount: 0,
          unitAmount: null,
        }
      : {
          id: `${key}-fee`,
          archived: false,
          meterId: null,
          amountType: 'fixed',
          priceAmount: PLAN_CATALOG[key].platformFeeCents,
          priceCurrency: 'eur',
          minimumAmount: null,
          unitAmount: null,
        };
  return [
    platform,
    ...TIMELINE_METER_SPECS.map((spec) => ({
      id: `${key}-${spec.key}`,
      archived: false,
      meterId: `meter-${spec.key}`,
      amountType: 'metered_unit' as const,
      priceAmount: null,
      priceCurrency: 'eur',
      minimumAmount: null,
      unitAmount: spec.unitAmount,
    })),
  ];
}

function product(key: TimelineProductKey): PolarSetupProduct {
  const plan = PLAN_CATALOG[key];
  return {
    id: `product-${key}`,
    name: `Timeline ${plan.name}`,
    archived: false,
    metadata: {
      timeline_key: key,
      included_active_members:
        plan.includedActiveMembers === null ? 'unlimited' : String(plan.includedActiveMembers),
    },
    prices: productPrices(key),
  };
}

function webhook(overrides: Partial<PolarSetupWebhook> = {}): PolarSetupWebhook {
  return {
    id: 'wh-timeline',
    url: DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
    enabled: true,
    format: 'raw',
    apiVersion: '2026-10',
    events: [...TIMELINE_POLAR_WEBHOOK_EVENTS],
    metadata: { timeline_key: 'webhook' },
    ...overrides,
  };
}

function readySnapshot(): PolarSetupSnapshot {
  return {
    meters: TIMELINE_METER_SPECS.map(meter),
    products: TIMELINE_PRODUCT_KEYS.map(product),
    webhooks: [webhook()],
    discounts: [],
  };
}

function emptySnapshot(): PolarSetupSnapshot {
  return { meters: [], products: [], webhooks: [], discounts: [] };
}

function actionsOf(
  plan: ReturnType<typeof planPolarSetup>,
  kind: ReturnType<typeof planPolarSetup>['actions'][number]['kind'],
) {
  return plan.actions.filter((action) => action.kind === kind);
}

describe('planPolarSetup', () => {
  it('plans the six meters, four monthly products, and webhook from an empty org', () => {
    const plan = planPolarSetup(emptySnapshot(), request);
    expect(actionsOf(plan, 'create_meter')).toHaveLength(TIMELINE_METER_SPECS.length);
    expect(actionsOf(plan, 'create_product')).toHaveLength(4);
    expect(actionsOf(plan, 'create_webhook')).toHaveLength(1);
    expect(plan.actions.some((action) => action.kind === 'archive_product')).toBe(false);
    expect(plan.actions.some((action) => action.kind === 'patch_discount')).toBe(false);

    const member = plan.actions.find(
      (action) =>
        action.kind === 'create_meter' && action.eventName === 'timeline_extra_member_days',
    );
    expect(member?.kind).toBe('create_meter');
    if (member?.kind !== 'create_meter') return;
    expect(member.body.unit).toBe('custom');
    expect(member.body.custom_label).toBe('member-month');
    expect(member.body.metadata.timeline_key).toBe('member_days');
    expect(member.scalarFallback?.unit).toBe('scalar');
    expect(member.scalarFallback).not.toHaveProperty('custom_label');

    const team = plan.actions.find(
      (action) => action.kind === 'create_product' && action.productKey === 'team',
    );
    expect(team?.kind).toBe('create_product');
    if (team?.kind !== 'create_product') return;
    expect(team.body.name).toBe('Timeline Team');
    expect(team.body.recurring_interval).toBe('month');
    expect(team.body.metadata).toEqual({
      timeline_key: 'team',
      included_active_members: '25',
    });
    expect(team.body.prices[0]).toEqual({
      amount_type: 'fixed',
      price_currency: 'eur',
      price_amount: PLAN_CATALOG.team.platformFeeCents,
    });
    const meterPrices = team.body.prices.slice(1);
    expect(meterPrices).toHaveLength(TIMELINE_METERED_EVENT_NAMES.length);
    expect(meterPrices).toEqual(
      TIMELINE_METER_SPECS.map((spec) => ({
        amount_type: 'metered_unit',
        price_currency: 'eur',
        meter_id: `$meter:${spec.eventName}`,
        unit_amount: spec.unitAmount,
      })),
    );

    const enterprise = plan.actions.find(
      (action) => action.kind === 'create_product' && action.productKey === 'enterprise',
    );
    expect(enterprise?.kind).toBe('create_product');
    if (enterprise?.kind !== 'create_product') return;
    expect(enterprise.body.prices[0]).toEqual({
      amount_type: 'custom',
      price_currency: 'eur',
      minimum_amount: 0,
    });
    const payg = plan.actions.find(
      (action) => action.kind === 'create_product' && action.productKey === 'payg',
    );
    expect(payg?.kind).toBe('create_product');
    if (payg?.kind !== 'create_product') return;
    expect(payg.body.prices[0]).toMatchObject({ price_amount: 0 });
    expect(payg.body.metadata.included_active_members).toBe('3');
    const business = plan.actions.find(
      (action) => action.kind === 'create_product' && action.productKey === 'business',
    );
    expect(business?.kind).toBe('create_product');
    if (business?.kind !== 'create_product') return;
    expect(business.body.prices[0]).toMatchObject({
      price_amount: PLAN_CATALOG.business.platformFeeCents,
    });
    expect(business.body.metadata.included_active_members).toBe('100');
  });

  it('keeps catalog unit amounts aligned with the overage rates', () => {
    expect(TIMELINE_METERED_UNIT_AMOUNTS.timeline_ai_eur_cents).toBe('1');
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_recall_minutes)).toBe(
      OVERAGE_RATES.recallCentsPerMinute,
    );
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_email_units)).toBe(
      OVERAGE_RATES.emailCentsPerThousandUnits / 1000,
    );
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_storage_gb_month)).toBe(
      OVERAGE_RATES.storageCentsPerGbMonth,
    );
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_accepted_sources)).toBe(
      OVERAGE_RATES.acceptedSourcesCentsPerThousand / 1000,
    );
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_extra_member_days)).toBe(
      OVERAGE_RATES.additionalMemberCentsPerMonth,
    );
  });

  it('makes no changes when the Timeline catalog is already correct', () => {
    const plan = planPolarSetup(readySnapshot(), request);
    expect(plan.actions).toEqual([]);
    expect(plan.notes.join('\n')).toContain('Included-usage discounts stay on the local invoice');
  });

  it('replaces a wrong immutable price and keeps an unrelated seat price', () => {
    const snapshot = readySnapshot();
    const team = snapshot.products.find((item) => item.id === 'product-team');
    if (!team) throw new Error('missing team');
    team.prices = [
      {
        id: 'team-fee',
        archived: false,
        meterId: null,
        amountType: 'fixed',
        priceAmount: 1_000,
        priceCurrency: 'eur',
        minimumAmount: null,
        unitAmount: null,
      },
      {
        id: 'team-seat',
        archived: false,
        meterId: null,
        amountType: 'seat',
        priceAmount: 100,
        priceCurrency: 'eur',
        minimumAmount: null,
        unitAmount: null,
      },
      ...productPrices('team')
        .slice(1)
        .map((price) =>
          price.id === 'team-recall_minutes' ? { ...price, unitAmount: '1' } : price,
        ),
    ];
    const plan = planPolarSetup(snapshot, request);
    const patches = plan.actions.filter((action) => action.kind === 'patch_product');
    expect(patches).toHaveLength(1);
    const patch = patches[0];
    if (patch?.kind !== 'patch_product') return;
    expect(patch.id).toBe('product-team');
    const prices = patch.body.prices ?? [];
    expect(prices[0]).toEqual({
      amount_type: 'fixed',
      price_currency: 'eur',
      price_amount: 4_900,
    });
    expect(prices).toContainEqual({ id: 'team-seat' });
    expect(prices).not.toContainEqual({ id: 'team-fee' });
    expect(prices).not.toContainEqual({ id: 'team-recall_minutes' });
    expect(prices).toContainEqual({
      amount_type: 'metered_unit',
      price_currency: 'eur',
      meter_id: 'meter-recall_minutes',
      unit_amount: '3',
    });
    expect(prices).toContainEqual({ id: 'team-ai' });
  });

  it('treats an equivalent decimal unit amount as already correct', () => {
    const snapshot = readySnapshot();
    const business = snapshot.products.find((item) => item.id === 'product-business');
    if (!business) throw new Error('missing business');
    business.prices = business.prices.map((price) =>
      price.id === 'business-email_units' ? { ...price, unitAmount: '0.2500' } : price,
    );
    const plan = planPolarSetup(snapshot, request);
    expect(plan.actions).toEqual([]);
  });

  it('archives a duplicate meter price and a wrong enterprise fee', () => {
    const snapshot = readySnapshot();
    const team = snapshot.products.find((item) => item.id === 'product-team');
    const enterprise = snapshot.products.find((item) => item.id === 'product-enterprise');
    if (!team || !enterprise) throw new Error('missing product');
    const recall = team.prices.find((price) => price.id === 'team-recall_minutes');
    if (!recall) throw new Error('missing recall price');
    team.prices = [...team.prices, { ...recall, id: 'team-recall-duplicate' }];
    enterprise.prices = [
      {
        id: 'enterprise-fixed',
        archived: false,
        meterId: null,
        amountType: 'fixed',
        priceAmount: 50_000,
        priceCurrency: 'eur',
        minimumAmount: null,
        unitAmount: null,
      },
      {
        id: 'enterprise-custom',
        archived: false,
        meterId: null,
        amountType: 'custom',
        priceAmount: null,
        priceCurrency: 'eur',
        minimumAmount: 500,
        unitAmount: null,
      },
      ...enterprise.prices.slice(1),
    ];
    const plan = planPolarSetup(snapshot, request);
    const teamPatch = plan.actions.find(
      (action) => action.kind === 'patch_product' && action.productKey === 'team',
    );
    const enterprisePatch = plan.actions.find(
      (action) => action.kind === 'patch_product' && action.productKey === 'enterprise',
    );
    expect(teamPatch?.kind).toBe('patch_product');
    expect(enterprisePatch?.kind).toBe('patch_product');
    if (teamPatch?.kind !== 'patch_product' || enterprisePatch?.kind !== 'patch_product') return;
    expect(teamPatch.body.prices).toContainEqual({ id: 'team-recall_minutes' });
    expect(teamPatch.body.prices).not.toContainEqual({ id: 'team-recall-duplicate' });
    expect(enterprisePatch.body.prices?.[0]).toEqual({
      amount_type: 'custom',
      price_currency: 'eur',
      minimum_amount: 0,
    });
    expect(enterprisePatch.body.prices).not.toContainEqual({ id: 'enterprise-fixed' });
    expect(enterprisePatch.body.prices).not.toContainEqual({ id: 'enterprise-custom' });
  });

  it('stamps metadata without resending prices', () => {
    const snapshot = readySnapshot();
    const payg = snapshot.products.find((item) => item.id === 'product-payg');
    if (!payg) throw new Error('missing payg');
    payg.metadata = {};
    const plan = planPolarSetup(snapshot, request);
    const patch = plan.actions.find((action) => action.kind === 'patch_product');
    expect(patch?.kind).toBe('patch_product');
    if (patch?.kind !== 'patch_product') return;
    expect(patch.body.metadata).toEqual({
      timeline_key: 'payg',
      included_active_members: '3',
    });
    expect(patch.body.prices).toBeUndefined();
  });

  it('leaves foreign products, meters, and webhooks untouched', () => {
    const snapshot = readySnapshot();
    snapshot.products = [
      ...snapshot.products,
      {
        id: 'irmin-product',
        name: 'Irmin Team',
        archived: false,
        metadata: {},
        prices: [],
      },
      {
        id: 'irmin-topup',
        name: 'Irmin Top-up',
        archived: false,
        metadata: {},
        prices: [],
      },
    ];
    snapshot.meters = [
      ...snapshot.meters,
      {
        id: 'irmin-meter',
        name: 'Irmin minutes',
        eventName: 'irmin_minutes',
        metadata: {},
        archived: false,
      },
    ];
    snapshot.webhooks = [
      ...snapshot.webhooks,
      webhook({
        id: 'irmin-hook',
        url: 'https://irmin.example/api/v1/webhooks/polar',
        metadata: {},
      }),
      webhook({
        id: 'example-untagged',
        url: 'https://example.com/api/webhooks/polar',
        enabled: false,
        metadata: {},
      }),
    ];
    const plan = planPolarSetup(snapshot, {
      ...request,
      preferredProductIds: { team: 'irmin-product' },
    });
    expect(plan.actions).toEqual([]);
    expect(JSON.stringify(plan.actions)).not.toContain('irmin-product');
    expect(plan.notes.join('\n')).toContain('irmin-product');
    expect(plan.notes.join('\n')).toContain('left untouched');
    expect(JSON.stringify(plan.actions)).not.toContain('irmin-hook');
    expect(JSON.stringify(plan.actions)).not.toContain('example-untagged');
  });

  it('archives only a Timeline-owned top-up and a Timeline-tagged placeholder webhook', () => {
    const snapshot = readySnapshot();
    snapshot.products = [
      ...snapshot.products,
      {
        id: 'topup',
        name: TIMELINE_TOPUP_PRODUCT_NAME,
        archived: false,
        metadata: {},
        prices: [],
      },
    ];
    snapshot.webhooks = [
      ...snapshot.webhooks,
      webhook({
        id: 'placeholder',
        url: 'https://example.com/api/webhooks/polar',
        enabled: false,
        metadata: { timeline_key: 'webhook' },
      }),
    ];
    const plan = planPolarSetup(snapshot, request);
    expect(plan.actions.map((action) => action.kind).sort()).toEqual([
      'archive_product',
      'delete_webhook',
    ]);
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ kind: 'archive_product', id: 'topup' }),
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ kind: 'delete_webhook', id: 'placeholder' }),
    );
  });

  it('updates the webhook selected by id and ignores a similar path', () => {
    const snapshot = readySnapshot();
    snapshot.webhooks = [
      webhook({
        id: 'configured',
        url: 'https://old.example/api/webhooks/polar',
        metadata: {},
        events: ['order.paid'],
      }),
      webhook({
        id: 'similar',
        url: 'https://thetimeline.cc/api/webhooks/polar/extra',
        metadata: {},
        events: [],
      }),
    ];
    const plan = planPolarSetup(snapshot, { ...request, webhookId: 'configured' });
    expect(plan.actions.map((action) => action.kind)).toEqual(['patch_webhook']);
    const patch = plan.actions[0];
    expect(patch?.kind).toBe('patch_webhook');
    if (patch?.kind !== 'patch_webhook') return;
    expect(patch.id).toBe('configured');
    expect(patch.body.url).toBe(DEFAULT_TIMELINE_POLAR_WEBHOOK_URL);
    expect(patch.body.events).toEqual([...TIMELINE_POLAR_WEBHOOK_EVENTS]);
  });

  it('patches a selected Timeline placeholder instead of deleting it', () => {
    const snapshot = readySnapshot();
    snapshot.webhooks = [
      webhook({
        id: 'placeholder',
        url: 'https://example.com/api/webhooks/polar',
        enabled: false,
        metadata: { timeline_key: 'webhook' },
      }),
    ];
    const plan = planPolarSetup(snapshot, { ...request, webhookId: 'placeholder' });
    expect(plan.actions.map((action) => action.kind)).toEqual(['patch_webhook']);
  });

  it('reuses a Timeline discount and does not invent one', () => {
    const snapshot = readySnapshot();
    const foreign: PolarSetupDiscount = {
      id: 'foreign-discount',
      name: 'Irmin launch',
      code: 'LAUNCH',
      metadata: {},
    };
    const timeline: PolarSetupDiscount = {
      id: 'timeline-discount',
      name: 'Timeline Launch',
      code: 'launch',
      metadata: {},
    };
    snapshot.discounts = [foreign, timeline];
    const plan = planPolarSetup(snapshot, { ...request, discountCode: 'LAUNCH' });
    expect(plan.discount).toEqual({ id: 'timeline-discount', code: 'launch' });
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: 'patch_discount', id: 'timeline-discount' }),
    ]);
    expect(plan.notes.join('\n')).toContain('foreign-discount');
    const stamped = planPolarSetup(
      {
        ...snapshot,
        discounts: [{ ...timeline, metadata: { timeline_key: 'checkout' } }],
      },
      { ...request, discountCode: 'LAUNCH' },
    );
    expect(stamped.actions).toEqual([]);
    expect(stamped.discount?.id).toBe('timeline-discount');

    const missing = planPolarSetup(readySnapshot(), { ...request, discountCode: 'LAUNCH' });
    expect(missing.discount).toBeNull();
    expect(missing.actions.some((action) => action.kind === 'patch_discount')).toBe(false);
    expect(missing.notes.join('\n')).toContain('does not invent a Polar discount');
  });

  it('reuses a checkout discount found by metadata when no code was configured', () => {
    const snapshot = readySnapshot();
    snapshot.discounts = [
      {
        id: 'checkout',
        name: 'Timeline seasonal',
        code: 'SEASON',
        metadata: { timeline_key: 'checkout' },
      },
    ];
    const plan = planPolarSetup(snapshot, request);
    expect(plan.discount).toEqual({ id: 'checkout', code: 'SEASON' });
    expect(plan.actions).toEqual([]);
  });
});

describe('runPolarSetup', () => {
  it('applies an empty org once and leaves the second run unchanged', async () => {
    const state = memoryState();
    state.products.push({
      id: 'irmin-product',
      name: 'Irmin Team',
      archived: false,
      metadata: {},
      prices: [],
    });
    state.webhooks.push(
      webhook({
        id: 'irmin-hook',
        url: 'https://irmin.example/api/v1/webhooks/polar',
        metadata: {},
      }),
    );
    const client = memoryClient(state);
    const first = await runPolarSetup({ client, request, dryRun: false });
    expect(client.mutations).toHaveLength(
      TIMELINE_METER_SPECS.length + TIMELINE_PRODUCT_KEYS.length + 1,
    );
    expect(first.productIds.team).toBeTruthy();
    expect(first.meterIds.timeline_extra_member_days).toBeTruthy();
    expect(first.webhookSecret).toBe('whsec_test_secret');
    expect(JSON.stringify(client.mutations)).not.toContain('irmin-product');
    expect(JSON.stringify(client.mutations)).not.toContain('irmin-hook');

    client.mutations.length = 0;
    const second = await runPolarSetup({ client, request, dryRun: false });
    expect(second.plan.actions).toEqual([]);
    expect(client.mutations).toEqual([]);
    expect(state.products.some((item) => item.id === 'irmin-product' && !item.archived)).toBe(true);
  });

  it('does not call mutations during a dry run', async () => {
    const state = memoryState();
    const client = memoryClient(state);
    client.createMeter = () => {
      throw new Error('dry-run mutated a meter');
    };
    client.createProduct = () => {
      throw new Error('dry-run mutated a product');
    };
    client.createWebhook = () => {
      throw new Error('dry-run mutated a webhook');
    };
    const result = await runPolarSetup({ client, request, dryRun: true });
    expect(result.plan.actions.length).toBeGreaterThan(0);
    expect(result.productIds.team).toBeUndefined();
    expect(state.products).toEqual([]);
  });

  it('falls back to a scalar meter unit when the custom unit is rejected', async () => {
    const state = memoryState();
    const client = memoryClient(state);
    const created: PolarMeterWrite[] = [];
    client.createMeter = (body) => {
      created.push(body);
      if (body.unit === 'custom') return Promise.reject(new Error('custom unit rejected'));
      const id = `meter-${body.metadata.timeline_key ?? 'meter'}`;
      state.meters.push({
        id,
        name: body.name,
        eventName: body.filter.clauses[0].value,
        metadata: body.metadata,
        archived: false,
      });
      return Promise.resolve({ id });
    };
    await runPolarSetup({ client, request, dryRun: false });
    const memberCalls = created.filter((body) => body.metadata.timeline_key === 'member_days');
    expect(memberCalls.map((body) => body.unit)).toEqual(['custom', 'scalar']);
  });

  it('retries an enterprise custom price when Polar requires a maximum', async () => {
    const state = memoryState();
    const client = memoryClient(state);
    const attempts: PolarProductWrite[] = [];
    client.createProduct = async (body) => {
      attempts.push(body);
      const custom = body.prices.find(
        (price) => 'amount_type' in price && price.amount_type === 'custom',
      );
      if (custom && !('maximum_amount' in custom)) {
        throw new Error('Polar create product failed: maximum_amount is required');
      }
      return memoryClient(state).createProduct(body);
    };
    await runPolarSetup({ client, request, dryRun: false });
    const enterpriseAttempts = attempts.filter(
      (body) => body.metadata.timeline_key === 'enterprise',
    );
    expect(enterpriseAttempts).toHaveLength(2);
    expect(enterpriseAttempts[1]?.prices[0]).toMatchObject({
      amount_type: 'custom',
      maximum_amount: TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS,
    });
  });
});

describe('polar setup report', () => {
  it('prints the env block and railway targets without the access token', () => {
    const report = renderPolarSetupReport({
      server: 'sandbox',
      organizationId: 'org-1',
      dryRun: false,
      webhookSecret: 'whsec_test_secret',
      result: {
        plan: planPolarSetup(readySnapshot(), request),
        meterIds: { timeline_ai_eur_cents: 'meter-ai' },
        productIds: { team: 'product-team' },
        discount: { id: 'discount-1', code: 'LAUNCH' },
        webhookId: 'wh-timeline',
        webhookSecret: 'whsec_test_secret',
      },
    });
    expect(report).toContain('POLAR_SERVER=sandbox');
    expect(report).toContain('POLAR_ORGANIZATION_ID=org-1');
    expect(report).toContain('POLAR_PRODUCT_ID_TEAM=product-team');
    expect(report).toContain('POLAR_PRODUCT_ID_PAYG=');
    expect(report).toContain('POLAR_METER_ID_AI=meter-ai');
    expect(report).toContain('POLAR_DISCOUNT_ID=discount-1');
    expect(report).toContain('POLAR_DISCOUNT_CODE=LAUNCH');
    expect(report).toContain('POLAR_WEBHOOK_ID=wh-timeline');
    expect(report).toContain('POLAR_WEBHOOK_SECRET=whsec_test_secret');
    expect(report).toContain('document-extract-orchestrator');
    expect(report).toContain('BILLING_CHARGES_ENABLED');
    expect(report).not.toContain('POLAR_ACCESS_TOKEN=');
    expect(report).not.toMatch(/polar_oat_/u);
  });

  it('accepts any https webhook host and refuses a non-https URL', () => {
    expect(() => {
      assertTimelineWebhookUrl('https://irmin.example/api/v1/webhooks/polar');
    }).not.toThrow();
    expect(() => {
      assertTimelineWebhookUrl(DEFAULT_TIMELINE_POLAR_WEBHOOK_URL);
    }).not.toThrow();
    expect(() => {
      assertTimelineWebhookUrl('http://thetimeline.cc/api/webhooks/polar');
    }).toThrow(/https/u);
  });

  it('refuses production access without the flag', () => {
    expect(assertPolarSetupServer('sandbox', false)).toBe('sandbox');
    expect(assertPolarSetupServer('production', true)).toBe('production');
    expect(() => assertPolarSetupServer('production', false)).toThrow(/--allow-production/u);
  });
});

interface MemoryState {
  meters: PolarSetupMeter[];
  products: PolarSetupProduct[];
  webhooks: PolarSetupWebhook[];
  discounts: PolarSetupDiscount[];
  sequence: number;
}

function memoryState(): MemoryState {
  return { meters: [], products: [], webhooks: [], discounts: [], sequence: 1 };
}

function rememberPrice(price: PolarPriceWrite, state: MemoryState): PolarSetupPrice {
  if ('id' in price) {
    throw new Error(`memory client received an unresolved kept price ${price.id}`);
  }
  const id = `price-${state.sequence}`;
  state.sequence += 1;
  if (price.amount_type === 'fixed') {
    return {
      id,
      archived: false,
      meterId: null,
      amountType: 'fixed',
      priceAmount: price.price_amount,
      priceCurrency: 'eur',
      minimumAmount: null,
      unitAmount: null,
    };
  }
  if (price.amount_type === 'custom') {
    return {
      id,
      archived: false,
      meterId: null,
      amountType: 'custom',
      priceAmount: null,
      priceCurrency: 'eur',
      minimumAmount: price.minimum_amount,
      unitAmount: null,
    };
  }
  return {
    id,
    archived: false,
    meterId: price.meter_id,
    amountType: 'metered_unit',
    priceAmount: null,
    priceCurrency: 'eur',
    minimumAmount: null,
    unitAmount: price.unit_amount,
  };
}

function memoryClient(state: MemoryState): PolarSetupClient & { mutations: string[] } {
  const mutations: string[] = [];
  const storedPrice = (id: string) => {
    for (const product of state.products) {
      const price = product.prices.find((item) => item.id === id);
      if (price) return price;
    }
    return null;
  };
  return {
    mutations,
    listMeters() {
      return Promise.resolve(state.meters);
    },
    listProducts() {
      return Promise.resolve(state.products.filter((product) => !product.archived));
    },
    listWebhooks() {
      return Promise.resolve(state.webhooks);
    },
    listDiscounts() {
      return Promise.resolve(state.discounts);
    },
    createMeter(body) {
      mutations.push(`create_meter:${body.metadata.timeline_key ?? ''}`);
      const id = `meter-${body.metadata.timeline_key ?? 'meter'}`;
      state.meters.push({
        id,
        name: body.name,
        eventName: body.filter.clauses[0].value,
        metadata: body.metadata,
        archived: false,
      });
      return Promise.resolve({ id });
    },
    patchMeter(id, body) {
      mutations.push(`patch_meter:${id}`);
      const meterRow = state.meters.find((item) => item.id === id);
      if (meterRow) meterRow.metadata = body.metadata;
      return Promise.resolve();
    },
    createProduct(body) {
      mutations.push(`create_product:${body.metadata.timeline_key ?? ''}`);
      const id = `product-${body.metadata.timeline_key ?? 'product'}`;
      state.products.push({
        id,
        name: body.name,
        archived: false,
        metadata: body.metadata,
        prices: body.prices.map((price) => rememberPrice(price, state)),
      });
      return Promise.resolve({ id });
    },
    patchProduct(id, body: PolarProductPatch) {
      mutations.push(`patch_product:${id}`);
      const productRow = state.products.find((item) => item.id === id);
      if (!productRow) return Promise.resolve();
      if (body.metadata) productRow.metadata = body.metadata;
      if (body.prices) {
        productRow.prices = body.prices.map((price) => {
          if ('id' in price) {
            const existing = storedPrice(price.id);
            if (!existing) throw new Error(`missing price ${price.id}`);
            return existing;
          }
          return rememberPrice(price, state);
        });
      }
      return Promise.resolve();
    },
    archiveProduct(id) {
      mutations.push(`archive_product:${id}`);
      const productRow = state.products.find((item) => item.id === id);
      if (productRow) productRow.archived = true;
      return Promise.resolve();
    },
    createWebhook(body: PolarWebhookWrite) {
      mutations.push(`create_webhook:${body.url}`);
      const id = `wh-${state.sequence}`;
      state.sequence += 1;
      state.webhooks.push({
        id,
        url: body.url,
        enabled: body.enabled,
        format: body.format,
        apiVersion: body.api_version,
        events: body.events,
        metadata: body.metadata,
      });
      return Promise.resolve({ id, secret: 'whsec_test_secret' });
    },
    patchWebhook(id, body) {
      mutations.push(`patch_webhook:${id}`);
      const webhookRow = state.webhooks.find((item) => item.id === id);
      if (webhookRow) {
        webhookRow.url = body.url;
        webhookRow.enabled = body.enabled;
        webhookRow.format = body.format;
        webhookRow.apiVersion = body.api_version;
        webhookRow.events = body.events;
        webhookRow.metadata = body.metadata;
      }
      return Promise.resolve();
    },
    deleteWebhook(id) {
      mutations.push(`delete_webhook:${id}`);
      state.webhooks = state.webhooks.filter((item) => item.id !== id);
      return Promise.resolve();
    },
    patchDiscount(id, body) {
      mutations.push(`patch_discount:${id}`);
      const discount = state.discounts.find((item) => item.id === id);
      if (discount) discount.metadata = body.metadata;
      return Promise.resolve();
    },
  };
}
