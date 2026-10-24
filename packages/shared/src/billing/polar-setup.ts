import { OVERAGE_RATES } from '#src/billing/catalog.js';

/** Retired prepaid product. Setup archives any active copy and does not create one. */
export const TIMELINE_TOPUP_PRODUCT_NAME = 'Timeline Top-up';

/** Public fallback when this branch has no dev or staging deploy. */
export const DEFAULT_TIMELINE_POLAR_WEBHOOK_URL = 'https://thetimeline.cc/api/webhooks/polar';

export const TIMELINE_POLAR_WEBHOOK_NAME = 'Timeline';

/** Events the billing webhook handler applies. */
export const TIMELINE_POLAR_WEBHOOK_EVENTS = [
  'order.paid',
  'order.refunded',
  'refund.created',
  'refund.updated',
  'subscription.created',
  'subscription.active',
  'subscription.updated',
  'subscription.canceled',
  'subscription.revoked',
] as const;

export interface PolarSetupPrice {
  amountType?: string;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  minimumAmount?: number | null;
  presetAmount?: number | null;
}

export interface PolarSetupProduct {
  id: string;
  name: string;
  isArchived: boolean;
  isRecurring: boolean;
  prices: PolarSetupPrice[];
}

export interface PolarSetupWebhook {
  id: string;
  url: string;
  enabled: boolean;
  format?: string;
  events: string[];
}

export function polarApiBaseUrl(server: string | undefined): string {
  if (server === 'production') return 'https://api.polar.sh/v1';
  if (server === 'sandbox' || server === undefined || server === '') {
    return 'https://sandbox-api.polar.sh/v1';
  }
  throw new Error('POLAR_SERVER must be sandbox or production');
}

/** Active products named Timeline Top-up, including a recurring name collision. */
export function timelineTopUpsToArchive(products: PolarSetupProduct[]): PolarSetupProduct[] {
  return products.filter(
    (product) => product.name === TIMELINE_TOPUP_PRODUCT_NAME && !product.isArchived,
  );
}

/** Drop assignment lines for keys that must not stay in the env file. */
export function removeEnvAssignments(source: string, keys: readonly string[]): string {
  const drop = new Set(keys);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u).filter((line) => {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/u.exec(line);
    return !(match?.[1] && drop.has(match[1]));
  });
  return lines.join(newline);
}

export function webhookUrlKey(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/u, '') || '/';
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * Endpoints that belong to another product on a shared Polar org.
 * Setup must not update or delete these.
 */
export function isProtectedForeignWebhook(webhook: { url: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(webhook.url);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'irmin-development.up.railway.app' || host.includes('irmin')) return true;
  const path = parsed.pathname.replace(/\/+$/u, '') || '/';
  return path === '/api/v1/webhooks/polar';
}

/** Disabled placeholder whose path is Timeline's webhook route. */
export function isDisabledExampleTimelineWebhook(webhook: PolarSetupWebhook): boolean {
  if (webhook.enabled || isProtectedForeignWebhook(webhook)) return false;
  let parsed: URL;
  try {
    parsed = new URL(webhook.url);
  } catch {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/u, '') || '/';
  return parsed.hostname === 'example.com' && path === '/api/webhooks/polar';
}

export function assertTimelineWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Webhook URL must be absolute https');
  }
  if (parsed.protocol !== 'https:') throw new Error('Webhook URL must be absolute https');
  if (isProtectedForeignWebhook({ url })) {
    throw new Error('Refusing to attach the Timeline webhook to another product endpoint');
  }
}

export function selectTimelineWebhook(
  webhooks: PolarSetupWebhook[],
  targetUrl: string,
): PolarSetupWebhook | undefined {
  const key = webhookUrlKey(targetUrl);
  return webhooks.find((webhook) => {
    if (isProtectedForeignWebhook(webhook)) return false;
    try {
      return webhookUrlKey(webhook.url) === key;
    } catch {
      return false;
    }
  });
}

/** Enable raw delivery and add any missing Timeline events. Extra events stay. */
export function webhookNeedsUpdate(webhook: PolarSetupWebhook, events: readonly string[]): boolean {
  if (!webhook.enabled) return true;
  if (webhook.format !== undefined && webhook.format !== 'raw') return true;
  const have = new Set(webhook.events);
  return events.some((event) => !have.has(event));
}

export function mergedWebhookEvents(
  existing: readonly string[],
  required: readonly string[],
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const event of [...existing, ...required]) {
    if (seen.has(event)) continue;
    seen.add(event);
    merged.push(event);
  }
  return merged;
}

/** Polar event summed into extra-member invoice units. */
export const TIMELINE_EXTRA_MEMBER_EVENT_NAME = 'timeline_extra_member_days';

export const TIMELINE_EXTRA_MEMBER_METER_NAME = 'Timeline Extra members';

/** Cents per 1.0 member-month. Matches OVERAGE_RATES.additionalMemberCentsPerMonth. */
export const TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT = '200';

export interface TimelineExtraMemberMeterBody {
  name: string;
  filter: {
    conjunction: 'and';
    clauses: [{ property: 'name'; operator: 'eq'; value: string }];
  };
  aggregation: { func: 'sum'; property: 'units' };
  unit: 'custom' | 'scalar';
  custom_label?: 'member-month';
}

/** Meter create body. Custom unit labels the invoice "member-month"; scalar is the fallback. */
export function timelineExtraMemberMeterCreateBody(
  unit: 'custom' | 'scalar' = 'custom',
): TimelineExtraMemberMeterBody {
  return {
    name: TIMELINE_EXTRA_MEMBER_METER_NAME,
    filter: {
      conjunction: 'and',
      clauses: [{ property: 'name', operator: 'eq', value: TIMELINE_EXTRA_MEMBER_EVENT_NAME }],
    },
    aggregation: { func: 'sum', property: 'units' },
    unit,
    ...(unit === 'custom' ? { custom_label: 'member-month' as const } : {}),
  };
}

export function selectTimelineExtraMemberMeter<T extends { id: string; name: string }>(
  meters: readonly T[],
): T | undefined {
  return meters.find((meter) => meter.name === TIMELINE_EXTRA_MEMBER_METER_NAME);
}

export interface PolarCatalogPrice {
  id: string;
  isArchived?: boolean;
  meterId?: string | null;
  amountType?: string;
  minimumAmount?: number | null;
}

export type PolarPriceWrite =
  | { id: string }
  | {
      amount_type: 'metered_unit';
      price_currency: 'eur';
      meter_id: string;
      unit_amount: string;
    }
  | {
      amount_type: 'custom';
      price_currency: 'eur';
      minimum_amount: number;
      maximum_amount?: number;
    };

/**
 * Keep every current price id. Omitting one archives it on Polar.
 * Add the extra-member metered price only when that meter is not already attached.
 */
export function productPricesWithExtraMemberMeter(input: {
  prices: readonly PolarCatalogPrice[];
  meterId: string;
  unitAmount?: string;
}): PolarPriceWrite[] {
  const active = input.prices.filter((price) => price.id.length > 0 && price.isArchived !== true);
  const kept: PolarPriceWrite[] = active.map((price) => ({ id: price.id }));
  if (active.some((price) => price.meterId === input.meterId)) return kept;
  return [
    ...kept,
    {
      amount_type: 'metered_unit',
      price_currency: 'eur',
      meter_id: input.meterId,
      unit_amount: input.unitAmount ?? TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
    },
  ];
}

export const TIMELINE_ENTERPRISE_PRODUCT_NAME = 'Timeline Enterprise';

/** Shared metered prices. Unit amounts match the live Team product. */
export const TIMELINE_METERED_EVENT_NAMES = [
  'timeline_ai_eur_cents',
  'timeline_recall_minutes',
  'timeline_email_units',
  'timeline_storage_gb_month',
  'timeline_accepted_sources',
  TIMELINE_EXTRA_MEMBER_EVENT_NAME,
] as const;

export type TimelineMeteredEventName = (typeof TIMELINE_METERED_EVENT_NAMES)[number];

export const TIMELINE_METERED_UNIT_AMOUNTS: Record<TimelineMeteredEventName, string> = {
  timeline_ai_eur_cents: '1',
  timeline_recall_minutes: String(OVERAGE_RATES.recallCentsPerMinute),
  timeline_email_units: '0.25',
  timeline_storage_gb_month: String(OVERAGE_RATES.storageCentsPerGbMonth),
  timeline_accepted_sources: '0.05',
  timeline_extra_member_days: TIMELINE_EXTRA_MEMBER_UNIT_AMOUNT,
};

/** High ceiling so a missing Polar maximum can be retried without a €0 lock. */
export const TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS = 100_000_000;

export interface TimelineMeterFilterSource {
  id: string;
  filter?: { clauses?: readonly { value?: string }[] };
}

/** Map Timeline event names to meter ids. The first match for each event wins. */
export function timelineMeterIdsByEvent(
  meters: readonly TimelineMeterFilterSource[],
): Partial<Record<TimelineMeteredEventName, string>> {
  const wanted = new Set<string>(TIMELINE_METERED_EVENT_NAMES);
  const found: Partial<Record<TimelineMeteredEventName, string>> = {};
  for (const meter of meters) {
    const clauses = meter.filter?.clauses;
    if (!clauses || clauses.length === 0) continue;
    const first = clauses[0];
    const value = first?.value;
    if (!value || !wanted.has(value) || found[value as TimelineMeteredEventName]) continue;
    found[value as TimelineMeteredEventName] = meter.id;
  }
  return found;
}

export function timelineEnterpriseProductCreateBody(input: {
  meterIdsByEvent: Partial<Record<TimelineMeteredEventName, string>>;
  maximumAmount?: number;
}): {
  name: string;
  description: string;
  recurring_interval: 'month';
  prices: PolarPriceWrite[];
} {
  const missing = TIMELINE_METERED_EVENT_NAMES.filter(
    (eventName) => !input.meterIdsByEvent[eventName],
  );
  if (missing.length > 0) {
    throw new Error(`Timeline Enterprise is missing meters: ${missing.join(', ')}`);
  }
  const custom: PolarPriceWrite = {
    amount_type: 'custom',
    price_currency: 'eur',
    minimum_amount: 0,
    ...(input.maximumAmount !== undefined ? { maximum_amount: input.maximumAmount } : {}),
  };
  return {
    name: TIMELINE_ENTERPRISE_PRODUCT_NAME,
    description: 'Negotiated Timeline Enterprise platform fee plus metered usage.',
    recurring_interval: 'month',
    prices: [
      custom,
      ...TIMELINE_METERED_EVENT_NAMES.map((eventName) => ({
        amount_type: 'metered_unit' as const,
        price_currency: 'eur' as const,
        meter_id: input.meterIdsByEvent[eventName] ?? '',
        unit_amount: TIMELINE_METERED_UNIT_AMOUNTS[eventName],
      })),
    ],
  };
}

/**
 * Keep every current price id. Add the custom platform fee once, and add a
 * metered price only for a Timeline meter that is not already attached.
 * A wrong unit amount on an existing price is left alone.
 */
export function enterpriseProductPriceWrites(input: {
  prices: readonly PolarCatalogPrice[];
  meterIdsByEvent: Partial<Record<TimelineMeteredEventName, string>>;
  maximumAmount?: number;
}): PolarPriceWrite[] {
  const active = input.prices.filter((price) => price.id.length > 0 && price.isArchived !== true);
  const kept: PolarPriceWrite[] = active.map((price) => ({ id: price.id }));
  const attached = new Set(active.flatMap((price) => (price.meterId ? [price.meterId] : [])));
  const additions: PolarPriceWrite[] = [];
  const hasCustom = active.some(
    (price) =>
      price.amountType === 'custom' ||
      (typeof price.minimumAmount === 'number' &&
        !price.meterId &&
        price.amountType !== 'fixed' &&
        price.amountType !== 'metered_unit'),
  );
  if (!hasCustom) {
    additions.push({
      amount_type: 'custom',
      price_currency: 'eur',
      minimum_amount: 0,
      ...(input.maximumAmount !== undefined ? { maximum_amount: input.maximumAmount } : {}),
    });
  }
  for (const eventName of TIMELINE_METERED_EVENT_NAMES) {
    const meterId = input.meterIdsByEvent[eventName];
    if (!meterId || attached.has(meterId)) continue;
    additions.push({
      amount_type: 'metered_unit',
      price_currency: 'eur',
      meter_id: meterId,
      unit_amount: TIMELINE_METERED_UNIT_AMOUNTS[eventName],
    });
  }
  return [...kept, ...additions];
}

export function selectTimelineEnterpriseProduct<T extends { name: string; isArchived: boolean }>(
  products: readonly T[],
): T | undefined {
  return products.find(
    (product) => product.name === TIMELINE_ENTERPRISE_PRODUCT_NAME && !product.isArchived,
  );
}

/** Replace assignment lines. Append keys that are not already present. */
export function upsertEnvAssignments(source: string, updates: Record<string, string>): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/u);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) return line;
    const key = match[1];
    if (key === undefined || !Object.prototype.hasOwnProperty.call(updates, key)) return line;
    seen.add(key);
    return `${key}=${updates[key] ?? ''}`;
  });
  const missing = Object.entries(updates).filter(([key]) => !seen.has(key));
  if (missing.length === 0) return next.join(newline);
  while (next.length > 0 && next[next.length - 1] === '') next.pop();
  for (const [key, value] of missing) next.push(`${key}=${value}`);
  next.push('');
  return next.join(newline);
}
