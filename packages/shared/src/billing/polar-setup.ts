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
}

export type PolarPriceWrite =
  | { id: string }
  | {
      amount_type: 'metered_unit';
      price_currency: 'eur';
      meter_id: string;
      unit_amount: string;
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
