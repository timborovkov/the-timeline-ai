/**
 * Timeline v1 commercial catalog (EUR, excl. VAT).
 * Source: Timeline v1 pricing strategy — launch hypothesis, entitlements version `v1`.
 */

export const BILLING_ENTITLEMENTS_VERSION = 'v1' as const;

export type BillingPlanId = 'free' | 'payg' | 'team' | 'business' | 'enterprise';

export { polarEventNameForMeter, type BillingMeterId } from '#src/billing/meters.js';

export interface PlanCommercial {
  id: BillingPlanId;
  name: string;
  tagline: string;
  /** Monthly platform fee in euro cents. Null = custom. */
  platformFeeCents: number | null;
  /** Included active members in the base fee. */
  includedActiveMembers: number | null;
  /** Additional active member rate euro cents / member-month. */
  additionalMemberCents: number | null;
  /** Self-serve active-member ceiling. */
  maxActiveMembers: number | null;
  /** Monthly invoice discount against eligible meters, euro cents. */
  includedUsageDiscountCents: number;
  /** Default overage spend cap, euro cents. 0 is a hard stop on paid plans. */
  defaultSpendCapCents: number;
  paymentMethodRequired: boolean;
  supportLabel: string;
  highlighted?: boolean;
  cta: { label: string; href: string };
}

/** Native overage rates (paid self-serve). Free hard-stops at allowances. */
export const OVERAGE_RATES = {
  /** Customer AI charge = provider EUR cost × multiplier (after FX). */
  aiCustomerMultiplier: 4,
  recallCentsPerMinute: 3,
  emailCentsPerThousandUnits: 250,
  storageCentsPerGbMonth: 25,
  acceptedSourcesCentsPerThousand: 50,
  additionalMemberCentsPerMonth: 200,
} as const;

/** Binary MiB/GiB used by storage capacity, meters, and copy. */
export const BYTES_PER_MIB = 1024 ** 2;
export const BYTES_PER_GIB = 1024 ** 3;

/** Free storage ceiling (also the PAYG included floor): 100 MiB. */
export const FREE_STORAGE_MIB = 100;
export const FREE_STORAGE_GB = FREE_STORAGE_MIB / 1024;

/** Free-plan native allowances (also the PAYG included floor before overage). */
export const FREE_ALLOWANCES = {
  aiChargeCents: 200,
  recallMinutes: 60,
  emailUnits: 500,
  storageGb: FREE_STORAGE_GB,
  acceptedSources: 1_000,
  agentTurns: 50,
  activeMembers: 3,
} as const;

/** Convert stored bytes into GiB for capacity and the storage meter. */
export function storageGbFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes / BYTES_PER_GIB;
}

/**
 * Format a GiB quantity. Values below 1 GiB use MB so 20 MiB is not "0 GB".
 */
export function formatStorageGb(gb: number): string {
  if (!Number.isFinite(gb) || gb === 0) return '0 MB';
  const abs = Math.abs(gb);
  if (abs < 1) {
    const mb = gb * 1024;
    const rounded = Math.abs(mb) >= 10 ? mb.toFixed(0) : mb.toFixed(1);
    return `${Number(rounded).toLocaleString('en-IE')} MB`;
  }
  const rounded = abs >= 10 ? gb.toFixed(0) : gb.toFixed(2);
  return `${Number(rounded).toLocaleString('en-IE')} GB`;
}

export const PLAN_CATALOG: Record<BillingPlanId, PlanCommercial> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Enough to try it with one channel.',
    platformFeeCents: 0,
    includedActiveMembers: 3,
    additionalMemberCents: null,
    maxActiveMembers: 3,
    includedUsageDiscountCents: 0,
    defaultSpendCapCents: 0,
    paymentMethodRequired: false,
    supportLabel: 'Best effort',
    cta: { label: 'Start free', href: '/sign-up' },
  },
  payg: {
    id: 'payg',
    name: 'Pay as you go',
    tagline: '€0 platform fee. Free allowance remains; pay for measured overage.',
    platformFeeCents: 0,
    includedActiveMembers: 3,
    additionalMemberCents: 200,
    maxActiveMembers: 500,
    includedUsageDiscountCents: 0,
    defaultSpendCapCents: 2_500,
    paymentMethodRequired: true,
    supportLabel: 'Standard',
    highlighted: true,
    cta: { label: 'Add payment method', href: '/sign-up' },
  },
  team: {
    id: 'team',
    name: 'Team',
    tagline: 'Optional commitment: included members and up to €60 usage on the invoice.',
    platformFeeCents: 4_900,
    includedActiveMembers: 25,
    additionalMemberCents: 200,
    maxActiveMembers: 500,
    includedUsageDiscountCents: 6_000,
    defaultSpendCapCents: 10_000,
    paymentMethodRequired: true,
    supportLabel: 'Priority email target',
    cta: { label: 'Choose Team', href: '/sign-up' },
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'Larger included members and up to €250 usage on the invoice.',
    platformFeeCents: 19_900,
    includedActiveMembers: 100,
    additionalMemberCents: 200,
    maxActiveMembers: 500,
    includedUsageDiscountCents: 25_000,
    defaultSpendCapCents: 50_000,
    paymentMethodRequired: true,
    supportLabel: 'Faster target + onboarding',
    cta: { label: 'Choose Business', href: '/sign-up' },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Governance, procurement, committed volume, SLA, or dedicated support.',
    platformFeeCents: null,
    includedActiveMembers: null,
    additionalMemberCents: null,
    maxActiveMembers: null,
    includedUsageDiscountCents: 0,
    defaultSpendCapCents: 0,
    paymentMethodRequired: true,
    supportLabel: 'Contractual',
    cta: { label: 'Contact sales', href: '/help/support' },
  },
};

/** All commercial offers including Enterprise (catalog / internal). */
export const PUBLIC_PLAN_ORDER: BillingPlanId[] = [
  'free',
  'payg',
  'team',
  'business',
  'enterprise',
];

/** Self-serve columns on the public pricing grid/table. Enterprise is a contact nudge. */
export const SELF_SERVE_PLAN_ORDER: BillingPlanId[] = ['free', 'payg', 'team', 'business'];

/** Spend-cap warning thresholds (percent of monthly cap). */
export const SPEND_CAP_WARN_THRESHOLDS = [50, 75, 90, 100] as const;

export interface CapacityEntitlements {
  agentTurnsPerMonth: number | null;
  acceptedSourcesPerMonth: number | null;
  webhookRequestsPerMonth: number | null;
  inboundEmailPerMonth: number | null;
  storageGb: number | null;
  documents: number | null;
  indexedChunks: number | null;
  semanticSearchesPerMonth: number | null;
  recallMinutesPerMonth: number | null;
  concurrentRecallBots: number | null;
  customMcpServers: number | null;
  costlyWorkerConcurrency: number | null;
}

export const CAPACITY_BY_PLAN: Record<BillingPlanId, CapacityEntitlements> = {
  free: {
    agentTurnsPerMonth: FREE_ALLOWANCES.agentTurns,
    acceptedSourcesPerMonth: 1_000,
    webhookRequestsPerMonth: 10_000,
    inboundEmailPerMonth: 100,
    storageGb: FREE_STORAGE_GB,
    documents: 10_000,
    indexedChunks: 20_000,
    semanticSearchesPerMonth: 2_000,
    recallMinutesPerMonth: 60,
    concurrentRecallBots: 1,
    customMcpServers: 0,
    costlyWorkerConcurrency: 1,
  },
  payg: {
    agentTurnsPerMonth: 5_000,
    acceptedSourcesPerMonth: 100_000,
    webhookRequestsPerMonth: 250_000,
    inboundEmailPerMonth: 5_000,
    storageGb: 25,
    documents: 10_000,
    indexedChunks: 50_000,
    semanticSearchesPerMonth: 20_000,
    recallMinutesPerMonth: 3_000,
    concurrentRecallBots: 2,
    customMcpServers: 5,
    costlyWorkerConcurrency: 5,
  },
  team: {
    agentTurnsPerMonth: 10_000,
    acceptedSourcesPerMonth: 250_000,
    webhookRequestsPerMonth: 500_000,
    inboundEmailPerMonth: 10_000,
    storageGb: 50,
    documents: 10_000,
    indexedChunks: 100_000,
    semanticSearchesPerMonth: 50_000,
    recallMinutesPerMonth: 6_000,
    concurrentRecallBots: 3,
    customMcpServers: 10,
    costlyWorkerConcurrency: 10,
  },
  business: {
    agentTurnsPerMonth: 50_000,
    acceptedSourcesPerMonth: 1_000_000,
    webhookRequestsPerMonth: 2_500_000,
    inboundEmailPerMonth: 25_000,
    storageGb: 250,
    documents: 50_000,
    indexedChunks: 500_000,
    semanticSearchesPerMonth: 100_000,
    recallMinutesPerMonth: 30_000,
    concurrentRecallBots: 5,
    customMcpServers: 50,
    costlyWorkerConcurrency: 25,
  },
  enterprise: {
    agentTurnsPerMonth: null,
    acceptedSourcesPerMonth: null,
    webhookRequestsPerMonth: null,
    inboundEmailPerMonth: null,
    storageGb: null,
    documents: null,
    indexedChunks: null,
    semanticSearchesPerMonth: null,
    recallMinutesPerMonth: null,
    concurrentRecallBots: null,
    customMcpServers: null,
    costlyWorkerConcurrency: null,
  },
};

/** Editable EUR/USD planning rate for AI FX (replace with live rate later). */
export const BILLING_EUR_PER_USD = 0.92;

export function formatEuroFromCents(cents: number): string {
  const euros = cents / 100;
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: euros % 1 === 0 ? 0 : 2,
  }).format(euros);
}

const EURO_AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/u;

/**
 * Parse a non-negative euro amount into integer cents.
 * Rejects extra decimal places and binary-float inputs such as 1.005.
 */
export function parseEuroAmountToCents(raw: string): number {
  const value = raw.trim();
  if (!EURO_AMOUNT_RE.test(value)) {
    throw new Error('Enter a non-negative euro amount with at most two decimal places.');
  }
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/**
 * Convert OpenRouter `usage.cost` (USD, already includes the OpenRouter fee)
 * into Timeline customer AI charge euro cents: FX then ×4. Do not apply an
 * extra OpenRouter markup on top of `usage.cost`.
 */
export function customerAiChargeCentsFromOpenRouterUsd(providerUsd: number): {
  providerCostCents: number;
  customerChargeCents: number;
  /** Unrounded customer cents so settlement can accumulate sub-cent calls. */
  customerChargeExactCents: number;
} {
  const providerEur = providerUsd * BILLING_EUR_PER_USD;
  const customerChargeExactCents = providerEur * OVERAGE_RATES.aiCustomerMultiplier * 100;
  const providerCostCents = Math.round(providerEur * 100);
  const customerChargeCents = Math.round(customerChargeExactCents);
  return { providerCostCents, customerChargeCents, customerChargeExactCents };
}

export function recallChargeCents(minutes: number): number {
  return Math.round(minutes * OVERAGE_RATES.recallCentsPerMinute);
}

/**
 * Per-meeting active-bot duration ceiling (joining + waiting-room + call).
 * Auto-leave / reservation uses the smaller of this and remaining Free minutes.
 */
export const MEETING_MAX_DURATION_MINUTES_BY_PLAN: Record<BillingPlanId, number> = {
  free: 120,
  payg: 240,
  team: 360,
  business: 360,
  enterprise: 360,
};

/** Customer AI charge reserved before an Ask / web chat turn (€1). */
export const ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS = 100;

/** Conservative admission budget for the pinned embedding model, not settlement pricing. */
export const EMBEDDING_AI_RESERVE_USD_PER_MILLION_TOKENS = 0.1;

/** Worst-case reservation for background LLM (extract, digest, vision). */
export const BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS = 100;

/** Reservation TTL for Ask turns (covers long tool loops + presentation pass). */
export const ASK_AI_RESERVATION_TTL_MS = 30 * 60_000;

/** Reservation TTL for Recall bots (max meeting duration + buffer). */
export const RECALL_RESERVATION_TTL_MS = 8 * 60 * 60_000;

export function emailRecipientCount(toHeader: string): number {
  return toHeader
    .split(/[,;]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length;
}

export function emailChargeCents(units: number): number {
  return Math.round((units * OVERAGE_RATES.emailCentsPerThousandUnits) / 1000);
}

export function storageChargeCents(gbMonth: number): number {
  return Math.round(gbMonth * OVERAGE_RATES.storageCentsPerGbMonth);
}

export function acceptedSourcesChargeCents(items: number): number {
  return Math.round((items * OVERAGE_RATES.acceptedSourcesCentsPerThousand) / 1000);
}
