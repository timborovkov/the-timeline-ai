/**
 * Timeline v1 commercial catalog (EUR, excl. VAT).
 * Source: Timeline v1 pricing strategy — launch hypothesis, entitlements version `v1`.
 */

export const BILLING_ENTITLEMENTS_VERSION = 'v1' as const;

export type BillingPlanId = 'free' | 'payg' | 'team' | 'business' | 'enterprise';

export type BillingMeterId =
  | 'ai'
  | 'recall_minutes'
  | 'email_units'
  | 'storage_gb_month'
  | 'accepted_sources'
  | 'member_days';

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
  /** Default overage spend cap, euro cents. */
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
  /** OpenRouter fee already in usage.cost; apply FX then multiplier. */
  openRouterUsdMarkup: 1.055,
  recallCentsPerMinute: 3,
  emailCentsPerThousandUnits: 250,
  storageCentsPerGbMonth: 25,
  acceptedSourcesCentsPerThousand: 50,
  additionalMemberCentsPerMonth: 200,
} as const;

/** Free-plan native allowances (also the PAYG included floor before overage). */
export const FREE_ALLOWANCES = {
  aiChargeCents: 500,
  recallMinutes: 60,
  emailUnits: 500,
  storageGb: 1,
  acceptedSources: 1_000,
  agentTurns: 100,
  activeMembers: 3,
} as const;

export const PLAN_CATALOG: Record<BillingPlanId, PlanCommercial> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Useful for a real 1–3 person team. No card.',
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
    agentTurnsPerMonth: 100,
    acceptedSourcesPerMonth: 1_000,
    webhookRequestsPerMonth: 10_000,
    inboundEmailPerMonth: 100,
    storageGb: 1,
    documents: 100,
    indexedChunks: 2_000,
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
    documents: 5_000,
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

/**
 * Convert OpenRouter `usage.cost` (USD, already includes OpenRouter fee in many
 * routes) into Timeline customer AI charge euro cents.
 */
export function customerAiChargeCentsFromOpenRouterUsd(providerUsd: number): {
  providerCostCents: number;
  customerChargeCents: number;
} {
  const providerEur = providerUsd * OVERAGE_RATES.openRouterUsdMarkup * BILLING_EUR_PER_USD;
  const providerCostCents = Math.round(providerEur * 100);
  const customerChargeCents = Math.round(providerEur * OVERAGE_RATES.aiCustomerMultiplier * 100);
  return { providerCostCents, customerChargeCents };
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

/** Worst-case customer AI charge reserved before an Ask / web chat turn (€2.50). */
export const ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS = 250;

/** Worst-case reservation for background LLM (extract, embed, digest, vision). */
export const BACKGROUND_AI_RESERVE_CUSTOMER_CHARGE_CENTS = 100;

/** First PAYG prepaid top-up (strategy §3). */
export const PREPAID_TOPUP_CENTS = 1_000;

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

/** Wallet-backed plans can spend prepaid top-ups; Free hard-stops on native floors. */
export function planUsesPrepaidWallet(planId: string): boolean {
  return planId === 'payg' || planId === 'team' || planId === 'business' || planId === 'enterprise';
}

export function polarEventNameForMeter(meter: BillingMeterId): string | null {
  switch (meter) {
    case 'ai':
      return 'timeline_ai_eur_cents';
    case 'recall_minutes':
      return 'timeline_recall_minutes';
    case 'email_units':
      return 'timeline_email_units';
    case 'storage_gb_month':
      return 'timeline_storage_gb_month';
    case 'accepted_sources':
      return 'timeline_accepted_sources';
    case 'member_days':
      // Extra seats settle through the prepaid wallet ledger. Not a Polar meter
      // and not a Polar invoice line — Polar has no native seat meter in v1.
      return null;
  }
}
