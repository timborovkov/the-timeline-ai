import { PLAN_CATALOG, OVERAGE_RATES, TEAM_MONTHLY_SEAT_CENTS } from '#src/billing/catalog.js';
import {
  BILLING_METERS,
  TIMELINE_METERED_EVENT_NAMES,
  type TimelineMeteredEventName,
  type BillingMeterId,
} from '#src/billing/meters.js';

/**
 * Idempotent Polar catalog planning for Timeline billing.
 * Objects are Timeline's when their metadata `timeline_key` is set, their name
 * starts with "Timeline", or a meter filters a `timeline_` event. Planning never
 * matches another project and never excludes one by host or path.
 */

/** Retired prepaid product. Setup archives an active Timeline-owned copy and does not create one. */
export const TIMELINE_TOPUP_PRODUCT_NAME = 'Timeline Top-up';

const TIMELINE_METADATA_KEY = 'timeline_key';

/** Public fallback when this branch has no dev or staging deploy. */
export const DEFAULT_TIMELINE_POLAR_WEBHOOK_URL = 'https://thetimeline.cc/api/webhooks/polar';

const TIMELINE_POLAR_WEBHOOK_NAME = 'Timeline';

const TIMELINE_POLAR_WEBHOOK_API_VERSION = '2026-10';

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

/** Polar custom prices accept at most eight digits in minor currency units. */
export const TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS = 99_999_999;

const METER_PRICING = {
  ai: {
    name: 'Timeline AI',
    unitAmount: '1',
    unit: 'scalar',
  },
  recall_minutes: {
    name: 'Timeline Recall minutes',
    unitAmount: String(OVERAGE_RATES.recallCentsPerMinute),
    unit: 'scalar',
  },
  email_units: {
    name: 'Timeline Email units',
    unitAmount: '0.25',
    unit: 'scalar',
  },
  storage_gb_month: {
    name: 'Timeline Storage',
    // Polar meters have no included/credited units. The Free/PAYG floor is
    // FREE_ALLOWANCES.storageGb (100 MiB), applied locally before ingest.
    unitAmount: String(OVERAGE_RATES.storageCentsPerGbMonth),
    unit: 'scalar',
  },
  accepted_sources: {
    name: 'Timeline Accepted sources',
    unitAmount: '0.05',
    unit: 'scalar',
  },
  member_days: {
    name: 'Timeline Extra members',
    unitAmount: String(OVERAGE_RATES.additionalMemberCentsPerMonth),
    unit: 'custom',
  },
} as const satisfies Record<
  BillingMeterId,
  { name: string; unitAmount: string; unit: 'scalar' | 'custom' }
>;

export const TIMELINE_METER_SPECS = BILLING_METERS.map((meter) => ({
  ...meter,
  ...METER_PRICING[meter.key],
}));

export {
  TIMELINE_METERED_EVENT_NAMES,
  type TimelineMeteredEventName,
} from '#src/billing/meters.js';

export const TIMELINE_METERED_UNIT_AMOUNTS: Record<TimelineMeteredEventName, string> =
  Object.fromEntries(
    TIMELINE_METER_SPECS.map((spec) => [spec.eventName, spec.unitAmount]),
  ) as Record<TimelineMeteredEventName, string>;

export const TIMELINE_PRODUCT_KEYS = ['team', 'enterprise'] as const;

export type TimelineProductKey = (typeof TIMELINE_PRODUCT_KEYS)[number];

export const TIMELINE_PRODUCT_ENV_NAMES: Record<TimelineProductKey, string> = {
  team: 'POLAR_PRODUCT_ID_TEAM',
  enterprise: 'POLAR_PRODUCT_ID_ENTERPRISE',
};

const TIMELINE_METER_ENV_NAMES: Record<TimelineMeteredEventName, string> = {
  timeline_ai_eur_cents: 'POLAR_METER_ID_AI',
  timeline_recall_minutes: 'POLAR_METER_ID_RECALL_MINUTES',
  timeline_email_units: 'POLAR_METER_ID_EMAIL_UNITS',
  timeline_storage_gb_month: 'POLAR_METER_ID_STORAGE_GB_MONTH',
  timeline_accepted_sources: 'POLAR_METER_ID_ACCEPTED_SOURCES',
  timeline_extra_member_days: 'POLAR_METER_ID_EXTRA_MEMBER_DAYS',
};

const TOPUP_METADATA_KEY = 'topup';
const WEBHOOK_METADATA_KEY = 'webhook';
const METER_ID_PREFIX = '$meter:';

export function polarApiBaseUrl(server: string | undefined): string {
  if (server === 'production') return 'https://api.polar.sh/v1';
  if (server === 'sandbox' || server === undefined || server === '') {
    return 'https://sandbox-api.polar.sh/v1';
  }
  throw new Error('POLAR_SERVER must be sandbox or production');
}

/** Sandbox is the default. Production listing and writes both require the flag. */
export function assertPolarSetupServer(
  server: string,
  allowProduction: boolean,
): 'sandbox' | 'production' {
  if (server !== 'sandbox' && server !== 'production') {
    throw new Error('POLAR_SERVER must be sandbox or production');
  }
  if (server === 'production' && !allowProduction) {
    throw new Error('Refusing to access production Polar unless --allow-production is set');
  }
  return server;
}

function webhookUrlKey(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/u, '') || '/';
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** The operator's webhook URL must be absolute https. Any host is allowed. */
export function assertTimelineWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Webhook URL must be an absolute https URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must be an absolute https URL');
  }
}

export interface PolarSetupMeter {
  id: string;
  name: string;
  eventName: string | null;
  metadata: Record<string, string>;
  archived: boolean;
}

export interface PolarSetupPrice {
  id: string;
  archived: boolean;
  meterId: string | null;
  amountType: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  minimumAmount: number | null;
  unitAmount: string | null;
  taxBehavior?: string | null;
  seatTiers?: unknown;
}

export interface PolarSetupProduct {
  id: string;
  name: string;
  archived: boolean;
  metadata: Record<string, string>;
  prices: readonly PolarSetupPrice[];
  recurringInterval?: string | null;
  recurringIntervalCount?: number | null;
}

export interface PolarSetupWebhook {
  id: string;
  url: string;
  enabled: boolean;
  format: string | null;
  apiVersion: string | null;
  events: readonly string[];
  metadata: Record<string, string>;
}

export interface PolarSetupSnapshot {
  meters: readonly PolarSetupMeter[];
  products: readonly PolarSetupProduct[];
  webhooks: readonly PolarSetupWebhook[];
}

export interface PolarSetupRequest {
  webhookUrl: string;
  webhookId: string | null;
  preferredProductIds: Partial<Record<TimelineProductKey, string>>;
}

const TEAM_SEAT_TIERS = {
  seat_tier_type: 'volume',
  tiers: [{ min_seats: 1, max_seats: null, price_per_seat: TEAM_MONTHLY_SEAT_CENTS }],
} as const;

export type PolarPriceWrite =
  | { id: string }
  | {
      amount_type: 'seat_based';
      price_currency: 'usd';
      tax_behavior: 'exclusive';
      seat_tiers: typeof TEAM_SEAT_TIERS;
    }
  | {
      amount_type: 'custom';
      price_currency: 'usd';
      tax_behavior: 'exclusive';
      minimum_amount: number;
      maximum_amount?: number;
    }
  | {
      amount_type: 'metered_unit';
      price_currency: 'usd';
      tax_behavior: 'exclusive';
      meter_id: string;
      unit_amount: string;
    };

export interface PolarMeterWrite {
  name: string;
  filter: {
    conjunction: 'and';
    clauses: [{ property: 'name'; operator: 'eq'; value: string }];
  };
  aggregation: { func: 'sum'; property: 'units' };
  unit: 'custom' | 'scalar';
  custom_label?: 'member-month';
  metadata: Record<string, string>;
}

export interface PolarProductWrite {
  name: string;
  description: string;
  recurring_interval: 'month';
  metadata: Record<string, string>;
  prices: PolarPriceWrite[];
}

export interface PolarProductPatch {
  metadata?: Record<string, string>;
  prices?: PolarPriceWrite[];
}

export interface PolarWebhookWrite {
  name?: string;
  url: string;
  format: 'raw';
  api_version: typeof TIMELINE_POLAR_WEBHOOK_API_VERSION;
  enabled: boolean;
  events: string[];
  metadata: Record<string, string>;
}

export type PolarSetupAction =
  | {
      kind: 'create_meter';
      eventName: TimelineMeteredEventName;
      body: PolarMeterWrite;
      scalarFallback: PolarMeterWrite | null;
      summary: string;
    }
  | {
      kind: 'patch_meter';
      id: string;
      eventName: TimelineMeteredEventName;
      body: { metadata: Record<string, string> };
      summary: string;
    }
  | {
      kind: 'create_product';
      productKey: TimelineProductKey;
      body: PolarProductWrite;
      customMaximumFallback: boolean;
      summary: string;
    }
  | {
      kind: 'patch_product';
      id: string;
      productKey: TimelineProductKey;
      body: PolarProductPatch;
      customMaximumFallback: boolean;
      summary: string;
    }
  | { kind: 'archive_product'; id: string; name: string; summary: string }
  | { kind: 'delete_webhook'; id: string; url: string; summary: string }
  | { kind: 'create_webhook'; body: PolarWebhookWrite; summary: string }
  | { kind: 'patch_webhook'; id: string; body: PolarWebhookWrite; summary: string };

export interface PolarSetupPlan {
  actions: PolarSetupAction[];
  notes: string[];
  meterIds: Partial<Record<TimelineMeteredEventName, string>>;
  productIds: Partial<Record<TimelineProductKey, string>>;
  webhookId: string | null;
}

export interface PolarSetupClient {
  getDefaultPresentmentCurrency(): Promise<string>;
  listMeters(): Promise<readonly PolarSetupMeter[]>;
  listProducts(): Promise<readonly PolarSetupProduct[]>;
  listWebhooks(): Promise<readonly PolarSetupWebhook[]>;
  createMeter(body: PolarMeterWrite): Promise<{ id: string }>;
  patchMeter(id: string, body: { metadata: Record<string, string> }): Promise<void>;
  createProduct(body: PolarProductWrite): Promise<{ id: string }>;
  patchProduct(id: string, body: PolarProductPatch): Promise<void>;
  archiveProduct(id: string): Promise<void>;
  createWebhook(body: PolarWebhookWrite): Promise<{ id: string; secret: string | null }>;
  patchWebhook(id: string, body: PolarWebhookWrite): Promise<void>;
  deleteWebhook(id: string): Promise<void>;
}

export interface PolarSetupRunResult {
  plan: PolarSetupPlan;
  meterIds: Partial<Record<TimelineMeteredEventName, string>>;
  productIds: Partial<Record<TimelineProductKey, string>>;
  webhookId: string | null;
  webhookSecret: string | null;
}

interface ProductSpec {
  key: TimelineProductKey;
  name: string;
  platform: 'seat_based' | 'custom';
  description: string;
}

const CHARGEABLE_METERS = TIMELINE_METER_SPECS.filter(
  (meter) => meter.key === 'ai' || meter.key === 'recall_minutes',
);

function timelineProductSpecs(): readonly ProductSpec[] {
  return [
    {
      key: 'team',
      name: 'Timeline Team',
      platform: 'seat_based',
      description: 'Monthly USD pricing per full workspace member.',
    },
    {
      key: 'enterprise',
      name: `Timeline ${PLAN_CATALOG.enterprise.name}`,
      platform: 'custom',
      description: PLAN_CATALOG.enterprise.tagline,
    },
  ];
}

function meterSpec(eventName: TimelineMeteredEventName) {
  const spec = TIMELINE_METER_SPECS.find((item) => item.eventName === eventName);
  if (!spec) throw new Error(`Unknown Timeline meter ${eventName}`);
  return spec;
}

function productSpec(key: TimelineProductKey): ProductSpec {
  const spec = timelineProductSpecs().find((item) => item.key === key);
  if (!spec) throw new Error(`Unknown Timeline product ${key}`);
  return spec;
}

function metadataStamp(current: Record<string, string>, stamp: Record<string, string>) {
  const changed = Object.entries(stamp).some(([key, value]) => current[key] !== value);
  return { changed, metadata: { ...current, ...stamp } };
}

function productMetadata(spec: ProductSpec): Record<string, string> {
  return {
    [TIMELINE_METADATA_KEY]: spec.key,
    timeline_pricing: 'usd-monthly',
  };
}

function sameUnitAmount(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return actual === expected;
  return left === right;
}

function priceCurrency(price: PolarSetupPrice): string {
  return (price.priceCurrency ?? '').toLowerCase();
}

function pendingMeterId(eventName: string): string {
  return `${METER_ID_PREFIX}${eventName}`;
}

function meterCreateBody(
  eventName: TimelineMeteredEventName,
  unit: 'custom' | 'scalar',
): PolarMeterWrite {
  const spec = meterSpec(eventName);
  return {
    name: spec.name,
    filter: {
      conjunction: 'and',
      clauses: [{ property: 'name', operator: 'eq', value: spec.eventName }],
    },
    aggregation: { func: 'sum', property: 'units' },
    unit,
    ...(unit === 'custom' ? { custom_label: 'member-month' as const } : {}),
    metadata: { [TIMELINE_METADATA_KEY]: spec.key },
  };
}

function platformPrice(spec: ProductSpec): PolarPriceWrite {
  const terms = { price_currency: 'usd', tax_behavior: 'exclusive' } as const;
  return spec.platform === 'custom'
    ? { ...terms, amount_type: 'custom', minimum_amount: 0 }
    : { ...terms, amount_type: 'seat_based', seat_tiers: TEAM_SEAT_TIERS };
}

function correctSeatTiers(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const terms = raw as Record<string, unknown>;
  if (terms.seat_tier_type !== 'volume' || !Array.isArray(terms.tiers) || terms.tiers.length !== 1)
    return false;
  const tier = terms.tiers[0] as Record<string, unknown> | null;
  return (
    tier?.min_seats === 1 &&
    (tier.max_seats === null || tier.max_seats === undefined) &&
    tier.price_per_seat === TEAM_MONTHLY_SEAT_CENTS
  );
}

/** Verify the configured product before offering a public Team checkout. */
export function isMonthlyUsdTeamCheckoutProduct(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as Record<string, unknown>;
  if (
    row.is_archived !== false ||
    row.recurring_interval !== 'month' ||
    row.recurring_interval_count !== 1 ||
    !Array.isArray(row.prices)
  )
    return false;
  const usdStaticPrices = (row.prices as (Record<string, unknown> | null)[]).filter(
    (price) => price?.is_archived === false && price.price_currency === 'usd' && !price.meter_id,
  );
  const price = usdStaticPrices[0];
  return (
    usdStaticPrices.length === 1 &&
    price?.amount_type === 'seat_based' &&
    price.tax_behavior === 'exclusive' &&
    correctSeatTiers(price.seat_tiers)
  );
}

function isCorrectPlatform(price: PolarSetupPrice, spec: ProductSpec): boolean {
  if (
    price.archived ||
    price.meterId ||
    priceCurrency(price) !== 'usd' ||
    price.taxBehavior !== 'exclusive' ||
    price.amountType !== spec.platform
  )
    return false;
  return spec.platform === 'seat_based'
    ? correctSeatTiers(price.seatTiers)
    : price.minimumAmount === 0;
}

function isCorrectMeterPrice(price: PolarSetupPrice, meterId: string, unitAmount: string): boolean {
  if (price.archived || price.meterId !== meterId || priceCurrency(price) !== 'usd') return false;
  if (price.amountType !== 'metered_unit' || price.taxBehavior !== 'exclusive') return false;
  return sameUnitAmount(price.unitAmount, unitAmount);
}

function meterEventIndex(
  meters: readonly PolarSetupMeter[],
): Map<string, TimelineMeteredEventName> {
  const index = new Map<string, TimelineMeteredEventName>();
  for (const meter of meters) {
    if (meter.archived || !meter.eventName) continue;
    const spec = TIMELINE_METER_SPECS.find((item) => item.eventName === meter.eventName);
    if (!spec) continue;
    index.set(meter.id, spec.eventName);
  }
  return index;
}

function planPrices(
  product: PolarSetupProduct | null,
  spec: ProductSpec,
  meterIds: ReadonlyMap<string, string>,
  metersById: ReadonlyMap<string, TimelineMeteredEventName>,
): { writes: PolarPriceWrite[]; reasons: string[] } {
  const active = (product?.prices ?? []).filter((price) => price.id.length > 0 && !price.archived);
  const correctPlatform = active.find((price) => isCorrectPlatform(price, spec));
  const correctByEvent = new Map<TimelineMeteredEventName, string>();
  for (const meter of CHARGEABLE_METERS) {
    const selectedId = meterIds.get(meter.eventName);
    if (!selectedId || selectedId.startsWith(METER_ID_PREFIX)) continue;
    const match = active.find((price) => isCorrectMeterPrice(price, selectedId, meter.unitAmount));
    if (match) correctByEvent.set(meter.eventName, match.id);
  }

  const kept: PolarPriceWrite[] = [];
  const reasons: string[] = [];
  const keptPlatform = new Set<string>();
  const keptEvents = new Set<string>();
  for (const price of active) {
    if (!price.meterId) {
      if (correctPlatform?.id === price.id && !keptPlatform.has(price.id)) {
        kept.push({ id: price.id });
        keptPlatform.add(price.id);
      } else {
        reasons.push(`archive ${price.amountType ?? 'platform'} price ${price.id}`);
      }
      continue;
    }
    const eventName = metersById.get(price.meterId);
    if (eventName) {
      const correctId = correctByEvent.get(eventName);
      if (correctId === price.id && !keptEvents.has(eventName)) {
        kept.push({ id: price.id });
        keptEvents.add(eventName);
      } else {
        reasons.push(`archive ${eventName} price ${price.id}`);
      }
      continue;
    }
    reasons.push(`archive unrecognized meter price ${price.id}`);
  }

  const platformAdditions: PolarPriceWrite[] = [];
  const meterAdditions: PolarPriceWrite[] = [];
  if (!correctPlatform) {
    platformAdditions.push(platformPrice(spec));
    reasons.push(
      spec.platform === 'seat_based' ? 'add monthly USD seat price' : 'add custom USD price',
    );
  }
  for (const meter of CHARGEABLE_METERS) {
    if (correctByEvent.has(meter.eventName)) continue;
    meterAdditions.push({
      amount_type: 'metered_unit',
      price_currency: 'usd',
      tax_behavior: 'exclusive',
      meter_id: meterIds.get(meter.eventName) ?? pendingMeterId(meter.eventName),
      unit_amount: meter.unitAmount,
    });
    reasons.push(`add ${meter.eventName} at unit ${meter.unitAmount}`);
  }
  return { writes: [...platformAdditions, ...kept, ...meterAdditions], reasons };
}

function productMatches(product: PolarSetupProduct, spec: ProductSpec): boolean {
  return (
    !product.archived &&
    product.recurringInterval === 'month' &&
    product.recurringIntervalCount === 1 &&
    product.metadata[TIMELINE_METADATA_KEY] === spec.key &&
    product.metadata.timeline_pricing === 'usd-monthly'
  );
}

function selectProduct(
  products: readonly PolarSetupProduct[],
  spec: ProductSpec,
  preferredId: string | undefined,
  notes: string[],
): PolarSetupProduct | null {
  if (preferredId) {
    const preferred = products.find((product) => product.id === preferredId);
    const envName = TIMELINE_PRODUCT_ENV_NAMES[spec.key];
    if (!preferred) {
      notes.push(
        `${envName} (${preferredId}) was not in this organization's active products. Looking up the Timeline product by metadata and name.`,
      );
    } else if (!productMatches(preferred, spec)) {
      notes.push(
        `${envName} (${preferredId}) is not the Timeline ${spec.name} product. It was left untouched.`,
      );
    } else {
      return preferred;
    }
  }
  const matches = products.filter((product) => productMatches(product, spec));
  const selected = matches[0];
  if (selected && matches.length > 1) {
    notes.push(
      `More than one ${spec.name} product is active. Reused ${selected.id} and left the others untouched.`,
    );
  }
  return selected ?? null;
}

function planMeters(
  meters: readonly PolarSetupMeter[],
  actions: PolarSetupAction[],
  notes: string[],
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const spec of TIMELINE_METER_SPECS) {
    const matches = meters.filter((meter) => !meter.archived && meter.eventName === spec.eventName);
    const selected =
      matches.find((meter) => meter.metadata[TIMELINE_METADATA_KEY] === spec.key) ?? matches[0];
    if (!selected) {
      const scalarFallback =
        spec.unit === 'custom' ? meterCreateBody(spec.eventName, 'scalar') : null;
      actions.push({
        kind: 'create_meter',
        eventName: spec.eventName,
        body: meterCreateBody(spec.eventName, spec.unit === 'custom' ? 'custom' : 'scalar'),
        scalarFallback,
        summary: `create meter ${spec.name} for ${spec.eventName}`,
      });
      ids.set(spec.eventName, pendingMeterId(spec.eventName));
      continue;
    }
    if (matches.length > 1) {
      notes.push(
        `More than one meter filters ${spec.eventName}. Reused ${selected.id} and left the others untouched.`,
      );
    }
    ids.set(spec.eventName, selected.id);
    const stamp = metadataStamp(selected.metadata, { [TIMELINE_METADATA_KEY]: spec.key });
    if (stamp.changed) {
      actions.push({
        kind: 'patch_meter',
        id: selected.id,
        eventName: spec.eventName,
        body: { metadata: stamp.metadata },
        summary: `stamp meter ${selected.id} ${TIMELINE_METADATA_KEY}=${spec.key}`,
      });
    }
  }
  for (const meter of meters) {
    if (meter.archived) continue;
    const key = meter.metadata[TIMELINE_METADATA_KEY];
    if (!key) continue;
    const spec = TIMELINE_METER_SPECS.find((item) => item.key === key);
    if (!spec || meter.eventName === spec.eventName) continue;
    notes.push(
      `Meter ${meter.id} has ${TIMELINE_METADATA_KEY}=${key} and filters ${meter.eventName ?? 'no event'}. It was left untouched.`,
    );
  }
  return ids;
}

function planProducts(
  products: readonly PolarSetupProduct[],
  meterIds: ReadonlyMap<string, string>,
  meters: readonly PolarSetupMeter[],
  preferredProductIds: Partial<Record<TimelineProductKey, string>>,
  actions: PolarSetupAction[],
  notes: string[],
): Map<TimelineProductKey, string> {
  const ids = new Map<TimelineProductKey, string>();
  const metersById = meterEventIndex(meters);
  const selectedIds = new Set<string>();
  for (const spec of timelineProductSpecs()) {
    const selected = selectProduct(products, spec, preferredProductIds[spec.key], notes);
    const priced = planPrices(selected, spec, meterIds, metersById);
    if (!selected) {
      actions.push({
        kind: 'create_product',
        productKey: spec.key,
        customMaximumFallback: spec.platform === 'custom',
        summary: `create product ${spec.name}`,
        body: {
          name: spec.name,
          description: spec.description,
          recurring_interval: 'month',
          metadata: productMetadata(spec),
          prices: priced.writes,
        },
      });
      continue;
    }
    ids.set(spec.key, selected.id);
    selectedIds.add(selected.id);
    const stamp = metadataStamp(selected.metadata, productMetadata(spec));
    if (!stamp.changed && priced.reasons.length === 0) continue;
    const body: PolarProductPatch = {};
    if (stamp.changed) body.metadata = stamp.metadata;
    if (priced.reasons.length > 0) body.prices = priced.writes;
    actions.push({
      kind: 'patch_product',
      id: selected.id,
      productKey: spec.key,
      customMaximumFallback: spec.platform === 'custom',
      body,
      summary: `update product ${spec.name} (${selected.id}): ${priced.reasons.join('; ') || 'stamp metadata'}`,
    });
  }

  for (const product of products) {
    if (product.archived || selectedIds.has(product.id)) continue;
    const timelineTopup =
      product.name === TIMELINE_TOPUP_PRODUCT_NAME ||
      product.metadata[TIMELINE_METADATA_KEY] === TOPUP_METADATA_KEY;
    const legacyKey = product.metadata[TIMELINE_METADATA_KEY];
    const legacyOffer =
      legacyKey === 'payg' ||
      legacyKey === 'business' ||
      ((legacyKey === 'team' || legacyKey === 'enterprise') &&
        product.metadata.timeline_pricing !== 'usd-monthly');
    if (!timelineTopup && !legacyOffer) continue;
    actions.push({
      kind: 'archive_product',
      id: product.id,
      name: product.name,
      summary: `archive product ${product.name} (${product.id})`,
    });
  }
  return ids;
}

function isTimelinePlaceholder(webhook: PolarSetupWebhook): boolean {
  if (webhook.enabled) return false;
  if (!webhook.metadata[TIMELINE_METADATA_KEY]) return false;
  try {
    const url = new URL(webhook.url);
    const path = url.pathname.replace(/\/+$/u, '') || '/';
    return url.hostname === 'example.com' && path === '/api/webhooks/polar';
  } catch {
    return false;
  }
}

function mergedEvents(existing: readonly string[]): string[] {
  const required: string[] = [...TIMELINE_POLAR_WEBHOOK_EVENTS];
  const extras = existing.filter((event) => !required.includes(event));
  return [...required, ...extras];
}

function sameEvents(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((event, index) => event === right[index]);
}

function selectWebhook(
  webhooks: readonly PolarSetupWebhook[],
  request: PolarSetupRequest,
): PolarSetupWebhook | null {
  // Identity is configuration, not a name or metadata rule. Polar does not
  // return webhook metadata, so another project's endpoint must not match.
  if (request.webhookId) {
    const byId = webhooks.find((webhook) => webhook.id === request.webhookId);
    if (byId) return byId;
  }
  let wanted: string;
  try {
    wanted = webhookUrlKey(request.webhookUrl);
  } catch {
    return null;
  }
  return (
    webhooks.find((webhook) => {
      try {
        return webhookUrlKey(webhook.url) === wanted;
      } catch {
        return false;
      }
    }) ?? null
  );
}

function webhookWrite(
  webhook: PolarSetupWebhook | null,
  request: PolarSetupRequest,
): PolarWebhookWrite {
  const events = mergedEvents(webhook?.events ?? []);
  const metadata = {
    ...(webhook?.metadata ?? {}),
    [TIMELINE_METADATA_KEY]: WEBHOOK_METADATA_KEY,
  };
  return {
    ...(webhook ? {} : { name: TIMELINE_POLAR_WEBHOOK_NAME }),
    url: request.webhookUrl,
    format: 'raw',
    api_version: TIMELINE_POLAR_WEBHOOK_API_VERSION,
    enabled: true,
    events,
    metadata,
  };
}

function webhookNeedsWrite(webhook: PolarSetupWebhook, request: PolarSetupRequest): boolean {
  // Polar webhook endpoints do not store metadata, and modified_at stays null.
  // Ownership is the saved id or the exact configured URL. A repeat run compares
  // only the fields Polar keeps: url, format, events, and enabled.
  const next = webhookWrite(webhook, request);
  let sameUrl = false;
  try {
    sameUrl = webhookUrlKey(webhook.url) === webhookUrlKey(request.webhookUrl);
  } catch {
    sameUrl = false;
  }
  return (
    !sameUrl ||
    webhook.format !== 'raw' ||
    !webhook.enabled ||
    !sameEvents(webhook.events, next.events)
  );
}

function planWebhooks(
  webhooks: readonly PolarSetupWebhook[],
  request: PolarSetupRequest,
  actions: PolarSetupAction[],
  notes: string[],
): string | null {
  const selected = selectWebhook(webhooks, request);
  if (request.webhookId && !webhooks.some((webhook) => webhook.id === request.webhookId)) {
    notes.push(`POLAR_WEBHOOK_ID (${request.webhookId}) was not in this organization's webhooks.`);
  }
  for (const webhook of webhooks) {
    if (selected?.id === webhook.id) continue;
    if (!isTimelinePlaceholder(webhook)) continue;
    actions.push({
      kind: 'delete_webhook',
      id: webhook.id,
      url: webhook.url,
      summary: `delete Timeline placeholder webhook ${webhook.url} (${webhook.id})`,
    });
  }
  if (!selected) {
    actions.push({
      kind: 'create_webhook',
      body: webhookWrite(null, request),
      summary: `create webhook ${request.webhookUrl}`,
    });
    return null;
  }
  if (webhookNeedsWrite(selected, request)) {
    actions.push({
      kind: 'patch_webhook',
      id: selected.id,
      body: webhookWrite(selected, request),
      summary: `update webhook ${selected.id}`,
    });
  }
  return selected.id;
}

export function planPolarSetup(
  snapshot: PolarSetupSnapshot,
  request: PolarSetupRequest,
): PolarSetupPlan {
  const actions: PolarSetupAction[] = [];
  const notes: string[] = [];
  const meterIds = planMeters(snapshot.meters, actions, notes);
  const selectedProducts = planProducts(
    snapshot.products,
    meterIds,
    snapshot.meters,
    request.preferredProductIds,
    actions,
    notes,
  );
  const webhookId = planWebhooks(snapshot.webhooks, request, actions, notes);
  const resolvedMeters: Partial<Record<TimelineMeteredEventName, string>> = {};
  for (const eventName of TIMELINE_METERED_EVENT_NAMES) {
    const id = meterIds.get(eventName);
    if (id && !id.startsWith(METER_ID_PREFIX)) resolvedMeters[eventName] = id;
  }
  const productIds: Partial<Record<TimelineProductKey, string>> = {};
  for (const key of TIMELINE_PRODUCT_KEYS) {
    const id = selectedProducts.get(key);
    if (id) productIds[key] = id;
  }
  return {
    actions,
    notes,
    meterIds: resolvedMeters,
    productIds,
    webhookId,
  };
}

export function renderPolarSetupPlan(plan: PolarSetupPlan): string {
  const lines = plan.actions.map((action) => action.summary);
  if (lines.length === 0) lines.push('No Polar changes.');
  if (plan.notes.length > 0) lines.push(...plan.notes.map((note) => `note: ${note}`));
  return lines.join('\n');
}

export function renderPolarSetupReport(input: {
  server: string;
  organizationId: string;
  dryRun: boolean;
  result: PolarSetupRunResult;
  webhookSecret: string | null;
}): string {
  const { result } = input;
  const lines = [
    input.dryRun
      ? 'Dry run. No Polar objects were changed. Unknown ids are blank.'
      : 'Polar setup results. Copy this block into the web and worker environment.',
    '',
    `POLAR_SERVER=${input.server}`,
    `POLAR_ORGANIZATION_ID=${input.organizationId}`,
    `POLAR_WEBHOOK_ID=${result.webhookId ?? ''}`,
    `POLAR_WEBHOOK_SECRET=${input.webhookSecret ?? ''}`,
  ];
  if (!input.webhookSecret) {
    lines.push(
      '# POLAR_WEBHOOK_SECRET was not returned. Keep the secret already stored for this endpoint.',
    );
  }
  for (const key of TIMELINE_PRODUCT_KEYS) {
    lines.push(`${TIMELINE_PRODUCT_ENV_NAMES[key]}=${result.productIds[key] ?? ''}`);
  }
  lines.push('# Meter ids are for operators. The app resolves meters by event name.');
  for (const eventName of TIMELINE_METERED_EVENT_NAMES) {
    lines.push(`${TIMELINE_METER_ENV_NAMES[eventName]}=${result.meterIds[eventName] ?? ''}`);
  }
  lines.push('');
  lines.push(
    'Railway: set POLAR_SERVER, POLAR_ORGANIZATION_ID, POLAR_WEBHOOK_ID, POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_ID_TEAM, POLAR_PRODUCT_ID_ENTERPRISE on the web and worker services. Leave the access token in the existing web and worker variables. document-extract-orchestrator stays credential-thin: copy BILLING_CHARGES_ENABLED there and do not copy Polar credentials onto it.',
  );
  return lines
    .filter((line) => !line.startsWith('POLAR_ACCESS_TOKEN='))
    .map((line) => line.replace(/polar_oat_[A-Za-z0-9]+/gu, 'polar_oat_[redacted]'))
    .join('\n');
}

function resolveMeterRefs(value: unknown, meterIds: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith(METER_ID_PREFIX)) {
    const eventName = value.slice(METER_ID_PREFIX.length);
    const id = meterIds.get(eventName);
    if (!id) throw new Error(`Missing Timeline meter ${eventName}`);
    return id;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => resolveMeterRefs(entry, meterIds));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = resolveMeterRefs(entry, meterIds);
    }
    return out;
  }
  return value;
}

function withCustomMaximum<T extends { prices?: readonly PolarPriceWrite[] }>(body: T): T {
  if (!body.prices) return body;
  return {
    ...body,
    prices: body.prices.map((price) => {
      if (!('amount_type' in price) || price.amount_type !== 'custom') return price;
      return { ...price, maximum_amount: TIMELINE_ENTERPRISE_CUSTOM_MAXIMUM_CENTS };
    }),
  };
}

function errorMentionsMaximum(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('maximum');
}

async function createMeter(
  client: PolarSetupClient,
  action: Extract<PolarSetupAction, { kind: 'create_meter' }>,
): Promise<string> {
  try {
    return (await client.createMeter(action.body)).id;
  } catch (error) {
    const listed = await client.listMeters();
    const found = listed.find((meter) => meter.eventName === action.eventName && !meter.archived);
    if (found) return found.id;
    if (!action.scalarFallback) throw error;
    try {
      return (await client.createMeter(action.scalarFallback)).id;
    } catch (scalarError) {
      const again = await client.listMeters();
      const foundAgain = again.find(
        (meter) => meter.eventName === action.eventName && !meter.archived,
      );
      if (foundAgain) return foundAgain.id;
      throw scalarError;
    }
  }
}

async function writeProduct(
  client: PolarSetupClient,
  action: Extract<PolarSetupAction, { kind: 'create_product' | 'patch_product' }>,
  meterIds: ReadonlyMap<string, string>,
): Promise<string | null> {
  if (action.kind === 'create_product') {
    const body = resolveMeterRefs(action.body, meterIds) as PolarProductWrite;
    try {
      return (await client.createProduct(body)).id;
    } catch (error) {
      const listed = await client.listProducts();
      const found = listed.find((product) =>
        productMatches(product, productSpec(action.productKey)),
      );
      if (found) return found.id;
      if (!action.customMaximumFallback || !errorMentionsMaximum(error)) throw error;
      return (await client.createProduct(withCustomMaximum(body))).id;
    }
  }
  const body = resolveMeterRefs(action.body, meterIds) as PolarProductPatch;
  try {
    await client.patchProduct(action.id, body);
    return action.id;
  } catch (error) {
    if (!action.customMaximumFallback || !errorMentionsMaximum(error)) throw error;
    await client.patchProduct(action.id, withCustomMaximum(body));
    return action.id;
  }
}

export async function runPolarSetup(input: {
  client: PolarSetupClient;
  request: PolarSetupRequest;
  dryRun: boolean;
}): Promise<PolarSetupRunResult> {
  const currency = await input.client.getDefaultPresentmentCurrency();
  if (currency !== 'usd') {
    throw new Error(
      `Polar organization default presentment currency is ${currency.toUpperCase()}. Timeline provisions a USD-only catalog. Configure USD as the default presentment currency in the selected Polar organization before running setup.`,
    );
  }
  const snapshot = {
    meters: await input.client.listMeters(),
    products: await input.client.listProducts(),
    webhooks: await input.client.listWebhooks(),
  };
  const plan = planPolarSetup(snapshot, input.request);
  const meterIds = new Map<string, string>(Object.entries(plan.meterIds));
  const productIds: Partial<Record<TimelineProductKey, string>> = { ...plan.productIds };
  let webhookId = plan.webhookId;
  let webhookSecret: string | null = null;
  if (input.dryRun) {
    return {
      plan,
      meterIds: plan.meterIds,
      productIds,
      webhookId,
      webhookSecret,
    };
  }
  for (const action of plan.actions) {
    if (action.kind === 'delete_webhook') await input.client.deleteWebhook(action.id);
  }
  for (const action of plan.actions) {
    if (action.kind !== 'create_meter') continue;
    const id = await createMeter(input.client, action);
    meterIds.set(action.eventName, id);
  }
  for (const action of plan.actions) {
    if (action.kind === 'patch_meter') await input.client.patchMeter(action.id, action.body);
  }
  for (const action of plan.actions) {
    if (action.kind !== 'create_product' && action.kind !== 'patch_product') continue;
    const id = await writeProduct(input.client, action, meterIds);
    if (id) productIds[action.productKey] = id;
  }
  for (const action of plan.actions) {
    if (action.kind === 'archive_product') await input.client.archiveProduct(action.id);
  }
  for (const action of plan.actions) {
    if (action.kind === 'create_webhook') {
      const created = await input.client.createWebhook(action.body);
      webhookId = created.id;
      webhookSecret = created.secret;
    }
    if (action.kind === 'patch_webhook') await input.client.patchWebhook(action.id, action.body);
  }
  const resolvedMeters: Partial<Record<TimelineMeteredEventName, string>> = {};
  for (const eventName of TIMELINE_METERED_EVENT_NAMES) {
    const id = meterIds.get(eventName);
    if (id) resolvedMeters[eventName] = id;
  }
  return {
    plan,
    meterIds: resolvedMeters,
    productIds,
    webhookId,
    webhookSecret,
  };
}
