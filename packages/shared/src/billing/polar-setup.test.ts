import { describe, expect, it } from 'vitest';

import { OVERAGE_RATES } from '#src/billing/catalog.js';
import {
  DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
  TIMELINE_EXTRA_MEMBER_EVENT_NAME,
  TIMELINE_EXTRA_MEMBER_METER_NAME,
  TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
  TIMELINE_POLAR_WEBHOOK_EVENTS,
  assertTimelineWebhookUrl,
  isDisabledExampleTimelineWebhook,
  isProtectedForeignWebhook,
  mergedWebhookEvents,
  enterpriseProductPriceWrites,
  productPricesWithExtraMemberMeter,
  selectTimelineEnterpriseProduct,
  TIMELINE_ENTERPRISE_PRODUCT_NAME,
  TIMELINE_METERED_EVENT_NAMES,
  TIMELINE_METERED_UNIT_AMOUNTS,
  timelineEnterpriseProductCreateBody,
  timelineMeterIdsByEvent,
  removeEnvAssignments,
  selectTimelineExtraMemberMeter,
  selectTimelineWebhook,
  timelineExtraMemberMeterCreateBody,
  timelineTopUpsToArchive,
  upsertEnvAssignments,
  webhookNeedsUpdate,
} from '#src/billing/polar-setup.js';

const topup = {
  id: 'topup-1',
  name: 'Timeline Top-up',
  isArchived: false,
  isRecurring: false,
  prices: [
    {
      amountType: 'custom',
      priceCurrency: 'eur',
      minimumAmount: 1000,
      presetAmount: 1000,
    },
  ],
};

describe('timeline top-up archival', () => {
  it('archives every active product named Timeline Top-up', () => {
    const archived = { ...topup, id: 'archived', isArchived: true };
    const recurring = { ...topup, id: 'recur', isRecurring: true };
    const other = { ...topup, id: 'other', name: 'Timeline Pay as you go' };
    expect(timelineTopUpsToArchive([archived, topup, recurring, other])).toEqual([
      topup,
      recurring,
    ]);
  });

  it('removes the retired top-up env key', () => {
    const next = removeEnvAssignments('POLAR_PRODUCT_ID_TOPUP=old\nPOLAR_WEBHOOK_ID=keep\n', [
      'POLAR_PRODUCT_ID_TOPUP',
    ]);
    expect(next).not.toContain('POLAR_PRODUCT_ID_TOPUP');
    expect(next).toContain('POLAR_WEBHOOK_ID=keep');
  });
});

describe('timeline webhook selection', () => {
  const irmin = {
    id: 'irmin',
    url: 'https://irmin-development.up.railway.app/api/v1/webhooks/polar',
    enabled: true,
    format: 'raw',
    events: ['order.paid'],
  };
  const example = {
    id: 'example',
    url: 'https://example.com/api/webhooks/polar',
    enabled: false,
    format: 'raw',
    events: ['order.paid'],
  };
  const timeline = {
    id: 'timeline',
    url: DEFAULT_TIMELINE_POLAR_WEBHOOK_URL,
    enabled: true,
    format: 'raw',
    events: [...TIMELINE_POLAR_WEBHOOK_EVENTS],
  };

  it('protects the Irmin endpoint and only deletes the disabled example.com placeholder', () => {
    expect(isProtectedForeignWebhook(irmin)).toBe(true);
    expect(isDisabledExampleTimelineWebhook(irmin)).toBe(false);
    expect(isDisabledExampleTimelineWebhook(example)).toBe(true);
    expect(isDisabledExampleTimelineWebhook({ ...example, enabled: true })).toBe(false);
    expect(() => {
      assertTimelineWebhookUrl(irmin.url);
    }).toThrow(/another product/);
    expect(() => {
      assertTimelineWebhookUrl(DEFAULT_TIMELINE_POLAR_WEBHOOK_URL);
    }).not.toThrow();
  });

  it('selects the Timeline URL and ignores the Irmin endpoint', () => {
    expect(
      selectTimelineWebhook([irmin, example, timeline], DEFAULT_TIMELINE_POLAR_WEBHOOK_URL)?.id,
    ).toBe('timeline');
    expect(webhookNeedsUpdate(timeline, TIMELINE_POLAR_WEBHOOK_EVENTS)).toBe(false);
    expect(webhookNeedsUpdate({ ...timeline, enabled: false }, TIMELINE_POLAR_WEBHOOK_EVENTS)).toBe(
      true,
    );
    expect(
      webhookNeedsUpdate({ ...timeline, events: ['order.paid'] }, TIMELINE_POLAR_WEBHOOK_EVENTS),
    ).toBe(true);
    expect(mergedWebhookEvents(['checkout.created'], ['order.paid'])).toEqual([
      'checkout.created',
      'order.paid',
    ]);
  });
});

describe('extra member meter prices', () => {
  const existing = ['fixed', 'ai', 'recall', 'email', 'storage', 'sources'].map((id) => ({ id }));

  it('creates a member-month meter and keeps every current price id', () => {
    expect(TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT).toBe(
      String(OVERAGE_RATES.additionalMemberCentsPerMonth),
    );
    expect(timelineExtraMemberMeterCreateBody().filter.clauses[0].value).toBe(
      TIMELINE_EXTRA_MEMBER_EVENT_NAME,
    );
    expect(timelineExtraMemberMeterCreateBody().unit).toBe('custom');
    expect(timelineExtraMemberMeterCreateBody().custom_label).toBe('member-month');
    expect(timelineExtraMemberMeterCreateBody('scalar').custom_label).toBeUndefined();
    expect(
      selectTimelineExtraMemberMeter([
        { id: 'other', name: 'Seats' },
        { id: 'extra', name: TIMELINE_EXTRA_MEMBER_METER_NAME },
      ])?.id,
    ).toBe('extra');

    const prices = productPricesWithExtraMemberMeter({
      prices: [...existing, { id: 'archived-price', isArchived: true }],
      meterId: 'meter-extra',
    });
    expect(prices).toHaveLength(existing.length + 1);
    expect(prices.slice(0, existing.length)).toEqual(existing.map((price) => ({ id: price.id })));
    expect(prices.at(-1)).toEqual({
      amount_type: 'metered_unit',
      price_currency: 'eur',
      meter_id: 'meter-extra',
      unit_amount: TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
    });
  });

  it('does not add a second extra-member price when the meter is already attached', () => {
    const prices = productPricesWithExtraMemberMeter({
      prices: [...existing, { id: 'extra-price', meterId: 'meter-extra' }],
      meterId: 'meter-extra',
    });
    expect(prices).toEqual([...existing.map((price) => ({ id: price.id })), { id: 'extra-price' }]);
  });
});

describe('env assignment updates', () => {
  it('replaces existing keys and appends missing ones', () => {
    const next = upsertEnvAssignments('POLAR_WEBHOOK_ID=\nOTHER=keep\n', {
      POLAR_WEBHOOK_ID: 'hook-id',
      POLAR_WEBHOOK_SECRET: 'whsec_test',
    });
    expect(next).toContain('POLAR_WEBHOOK_ID=hook-id');
    expect(next).toContain('OTHER=keep');
    expect(next).toContain('POLAR_WEBHOOK_SECRET=whsec_test');
    expect(next.endsWith('\n')).toBe(true);
  });
});

describe('Timeline Enterprise product', () => {
  const meterIds = {
    timeline_ai_eur_cents: 'm-ai',
    timeline_recall_minutes: 'm-recall',
    timeline_email_units: 'm-email',
    timeline_storage_gb_month: 'm-storage',
    timeline_accepted_sources: 'm-sources',
    timeline_extra_member_days: 'm-members',
  };

  it('maps meters by event name and builds a custom fee plus six metered prices', () => {
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_email_units) * 1000).toBe(
      OVERAGE_RATES.emailCentsPerThousandUnits,
    );
    expect(Number(TIMELINE_METERED_UNIT_AMOUNTS.timeline_accepted_sources) * 1000).toBe(
      OVERAGE_RATES.acceptedSourcesCentsPerThousand,
    );
    expect(TIMELINE_METERED_UNIT_AMOUNTS.timeline_recall_minutes).toBe(
      String(OVERAGE_RATES.recallCentsPerMinute),
    );
    expect(TIMELINE_METERED_UNIT_AMOUNTS.timeline_extra_member_days).toBe(
      TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
    );
    const ids = timelineMeterIdsByEvent([
      { id: 'foreign', filter: { clauses: [{ value: 'seats' }] } },
      ...TIMELINE_METERED_EVENT_NAMES.map((eventName) => ({
        id: meterIds[eventName],
        filter: { clauses: [{ value: eventName }] },
      })),
    ]);
    expect(ids).toEqual(meterIds);
    const body = timelineEnterpriseProductCreateBody({ meterIdsByEvent: ids });
    expect(body.name).toBe(TIMELINE_ENTERPRISE_PRODUCT_NAME);
    expect(body.recurring_interval).toBe('month');
    expect(body.prices[0]).toEqual({
      amount_type: 'custom',
      price_currency: 'eur',
      minimum_amount: 0,
    });
    expect(body.prices).toHaveLength(7);
    expect(body.prices.slice(1)).toEqual(
      TIMELINE_METERED_EVENT_NAMES.map((eventName) => ({
        amount_type: 'metered_unit',
        price_currency: 'eur',
        meter_id: meterIds[eventName],
        unit_amount: TIMELINE_METERED_UNIT_AMOUNTS[eventName],
      })),
    );
  });

  it('keeps existing price ids and adds the custom fee and missing meters once', () => {
    const first = enterpriseProductPriceWrites({
      prices: [{ id: 'fixed', amountType: 'fixed' }],
      meterIdsByEvent: meterIds,
    });
    expect(first[0]).toEqual({ id: 'fixed' });
    expect(
      first.filter((price) => 'amount_type' in price && price.amount_type === 'custom'),
    ).toHaveLength(1);
    expect(first).toHaveLength(8);
    const second = enterpriseProductPriceWrites({
      prices: first.flatMap((price, index) =>
        'id' in price
          ? [price]
          : [
              {
                id: `price-${String(index)}`,
                amountType: price.amount_type,
                ...('meter_id' in price ? { meterId: price.meter_id } : {}),
              },
            ],
      ),
      meterIdsByEvent: meterIds,
    });
    expect(second.every((price) => 'id' in price)).toBe(true);
    expect(
      selectTimelineEnterpriseProduct([
        {
          name: TIMELINE_ENTERPRISE_PRODUCT_NAME,
          isArchived: true,
          id: 'old',
        },
        { name: TIMELINE_ENTERPRISE_PRODUCT_NAME, isArchived: false, id: 'live' },
      ])?.id,
    ).toBe('live');
  });
});
