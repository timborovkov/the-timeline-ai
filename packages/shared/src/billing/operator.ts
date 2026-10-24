import { type BillingPlanId, PLAN_CATALOG } from '#src/billing/catalog.js';
import { billingStateAllowsReservation, billingStateForPaidPlan } from '#src/billing/status.js';

export type BillingArrangement = 'standard' | 'comped';

export interface TeamPriceOverride {
  platformFeeCents?: number;
  includedActiveMembers?: number;
  additionalMemberCents?: number;
  meteredDiscountPercent?: number;
}

/** Saved at Enterprise checkout. Applied by the paid subscription webhook. */
export interface PendingEnterpriseTerms extends TeamPriceOverride {
  platformFeeCents: number;
  spendCapCents?: number;
}

/**
 * Pending terms keyed by the Polar checkout that quoted them.
 * A legacy row is one unbound terms object from before checkout ids were stored.
 */
export type StoredPendingEnterpriseTerms =
  PendingEnterpriseTerms | { byCheckoutId: Record<string, PendingEnterpriseTerms> };

/** Fields an operator change snapshots into the audit log. */
export interface BillingOperatorSnapshot {
  arrangement: BillingArrangement;
  planId: BillingPlanId;
  billingState: string;
  spendCapCents: number;
  compReason: string | null;
  compExpiresAt: string | null;
  priceOverride: TeamPriceOverride | null;
  priceOverrideExpiresAt: string | null;
  /** Checkout-activated Enterprise platform fee. Null when Polar has no contracted fee. */
  enterprisePlatformFeeCents: number | null;
  pendingEnterpriseTerms: StoredPendingEnterpriseTerms | null;
  polarDiscountId: string | null;
  polarDiscountExpiresAt: string | null;
}

export interface BillingOperatorAccount {
  arrangement?: BillingArrangement | null;
  planId: BillingPlanId;
  billingState: string;
  spendCapCents: number;
  compReason?: string | null;
  compExpiresAt?: Date | null;
  priceOverride?: TeamPriceOverride | null;
  priceOverrideExpiresAt?: Date | null;
  enterprisePlatformFeeCents?: number | null;
  pendingEnterpriseTerms?: StoredPendingEnterpriseTerms | null;
  polarDiscountId?: string | null;
  polarDiscountExpiresAt?: Date | null;
}

export interface ResolvedCommercialTerms {
  planId: BillingPlanId;
  platformFeeCents: number | null;
  includedActiveMembers: number | null;
  additionalMemberCents: number | null;
  includedUsageDiscountCents: number;
  meteredDiscountPercent: number | null;
  maxActiveMembers: number | null;
}

export function platformAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/** Allowlist match. Team owner/admin is never enough. */
export function isPlatformAdminEmail(email: string, raw: string | undefined): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return platformAdminEmails(raw).includes(normalized);
}

function timestampExpired(expiresAt: Date | null | undefined, now: Date): boolean {
  return (
    expiresAt instanceof Date &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() <= now.getTime()
  );
}

export function compSuppressesPolarCharges(account: {
  arrangement?: BillingArrangement | null;
}): boolean {
  return account.arrangement === 'comped';
}

function isPendingEnterpriseTerms(value: unknown): value is PendingEnterpriseTerms {
  if (!value || typeof value !== 'object') return false;
  const fee = (value as { platformFeeCents?: unknown }).platformFeeCents;
  return typeof fee === 'number' && Number.isInteger(fee) && fee >= 0;
}

/** Split a stored blob into checkout-keyed terms and one legacy unbound object. */
export function readPendingEnterpriseTerms(stored: unknown): {
  byCheckoutId: Record<string, PendingEnterpriseTerms>;
  legacy: PendingEnterpriseTerms | null;
} {
  if (!stored || typeof stored !== 'object') return { byCheckoutId: {}, legacy: null };
  const record = stored as { byCheckoutId?: unknown };
  if (record.byCheckoutId && typeof record.byCheckoutId === 'object') {
    const byCheckoutId: Record<string, PendingEnterpriseTerms> = {};
    for (const [id, terms] of Object.entries(record.byCheckoutId)) {
      if (id.trim().length === 0 || !isPendingEnterpriseTerms(terms)) continue;
      byCheckoutId[id] = terms;
    }
    return { byCheckoutId, legacy: null };
  }
  if (isPendingEnterpriseTerms(stored)) return { byCheckoutId: {}, legacy: stored };
  return { byCheckoutId: {}, legacy: null };
}

/**
 * Terms for the checkout Polar says was paid.
 * A legacy unbound blob applies only when no checkout is keyed and the event
 * has no checkout id. A keyed map never falls through to a different checkout.
 */
export function pendingEnterpriseTermsForCheckout(
  stored: unknown,
  checkoutId: string | null,
): PendingEnterpriseTerms | null {
  const parsed = readPendingEnterpriseTerms(stored);
  if (checkoutId) return parsed.byCheckoutId[checkoutId] ?? null;
  if (Object.keys(parsed.byCheckoutId).length > 0) return null;
  return parsed.legacy;
}

/** Drop the checkout that just activated. Other unpaid checkouts keep their terms. */
export function pendingEnterpriseTermsAfterActivation(
  stored: unknown,
  checkoutId: string | null,
): StoredPendingEnterpriseTerms | null {
  if (!checkoutId) return null;
  const parsed = readPendingEnterpriseTerms(stored);
  const rest: Record<string, PendingEnterpriseTerms> = {};
  for (const [id, terms] of Object.entries(parsed.byCheckoutId)) {
    if (id === checkoutId) continue;
    rest[id] = terms;
  }
  if (Object.keys(rest).length === 0) return null;
  return { byCheckoutId: rest };
}

/**
 * A paid Enterprise contract, not a comp. Expired comps stay `enterprise_active`
 * while the effective plan is Free, and those accounts use Free allowances.
 */
export function contractualEnterpriseAccount(account: {
  arrangement?: BillingArrangement | null;
  planId: string;
  billingState: string;
}): boolean {
  return (
    account.arrangement !== 'comped' &&
    (account.planId === 'enterprise' || account.billingState === 'enterprise_active')
  );
}

export function isActiveComp(
  account: { arrangement?: BillingArrangement | null; compExpiresAt?: Date | null },
  now = new Date(),
): boolean {
  return account.arrangement === 'comped' && !timestampExpired(account.compExpiresAt, now);
}

/**
 * Capacity and meter math follow the comped plan until expiry, then Free.
 * Standard teams keep `planId`.
 */
export function effectiveBillingPlanId(
  account: BillingOperatorAccount,
  now = new Date(),
): BillingPlanId {
  if (account.arrangement !== 'comped') return account.planId;
  if (isActiveComp(account, now)) return account.planId;
  return 'free';
}

export function activePriceOverride(
  account: BillingOperatorAccount,
  now = new Date(),
): TeamPriceOverride | null {
  if (!account.priceOverride) return null;
  if (timestampExpired(account.priceOverrideExpiresAt, now)) return null;
  return account.priceOverride;
}

export function activePolarDiscountId(
  account: BillingOperatorAccount,
  now = new Date(),
): string | null {
  if (compSuppressesPolarCharges(account)) return null;
  const id = account.polarDiscountId?.trim();
  if (!id) return null;
  if (timestampExpired(account.polarDiscountExpiresAt, now)) return null;
  return id;
}

export function applyMeteredDiscountCents(
  cents: number,
  percent: number | null | undefined,
): number {
  if (percent === undefined || percent === null || percent <= 0) return cents;
  if (percent >= 100) return 0;
  return Math.round((cents * (100 - percent)) / 100);
}

export function resolveTeamCommercialTerms(
  account: BillingOperatorAccount,
  now = new Date(),
): ResolvedCommercialTerms {
  const planId = effectiveBillingPlanId(account, now);
  const catalog = PLAN_CATALOG[planId];
  const override = activePriceOverride(account, now);
  // The column is the Enterprise contract. PAYG, Team, and Business keep the
  // catalog fee (or an active override) after that contract ends.
  const contractedFee =
    planId === 'enterprise'
      ? (account.enterprisePlatformFeeCents ?? override?.platformFeeCents)
      : override?.platformFeeCents;
  return {
    planId,
    platformFeeCents: contractedFee ?? catalog.platformFeeCents,
    includedActiveMembers: override?.includedActiveMembers ?? catalog.includedActiveMembers,
    additionalMemberCents: override?.additionalMemberCents ?? catalog.additionalMemberCents,
    includedUsageDiscountCents: catalog.includedUsageDiscountCents,
    meteredDiscountPercent: override?.meteredDiscountPercent ?? null,
    maxActiveMembers: catalog.maxActiveMembers,
  };
}

export function billingStateForComp(planId: BillingPlanId) {
  return billingStateForPaidPlan(planId) ?? 'free';
}

/**
 * The spend cap counts the locally metered charge. Whether Polar will invoice
 * that charge (included credit, a comp, or the Free allowance) does not decide
 * it. Standard Free stays on the allowance gate. A contractual Enterprise
 * subscription is not frozen by the cap. Comps, including an expired comp
 * whose entitlements are Free, still enforce it.
 */
export function localChargeSpendCapApplies(input: {
  shadowBilling: boolean;
  comped: boolean;
  enterpriseContract: boolean;
  entitlementsPlanId: BillingPlanId;
}): boolean {
  if (input.shadowBilling || input.enterpriseContract) return false;
  if (input.entitlementsPlanId === 'free' && !input.comped) return false;
  return true;
}

export function compCostBearingPaused(input: {
  billingState: string;
  shadowBilling: boolean;
  entitlementsPlanId: BillingPlanId;
  spendCapCents: number;
  meteredSpendCents: number;
  freeAllowanceExhausted: boolean;
}): boolean {
  if (!billingStateAllowsReservation(input.billingState)) return true;
  if (input.shadowBilling) return false;
  const capHit = input.spendCapCents <= 0 || input.meteredSpendCents >= input.spendCapCents;
  if (input.entitlementsPlanId === 'free') return input.freeAllowanceExhausted || capHit;
  return capHit;
}

export function describeTeamComp(
  account: BillingOperatorAccount,
  now = new Date(),
): {
  active: boolean;
  expired: boolean;
  planName: string;
  reason: string | null;
  expiresOn: string | null;
} | null {
  if (account.arrangement !== 'comped') return null;
  const active = isActiveComp(account, now);
  const planName = PLAN_CATALOG[active ? account.planId : 'free'].name;
  return {
    active,
    expired: !active,
    planName,
    reason: account.compReason ?? null,
    expiresOn: account.compExpiresAt ? account.compExpiresAt.toISOString().slice(0, 10) : null,
  };
}

export function describePriceOverride(
  account: BillingOperatorAccount,
  now = new Date(),
): string | null {
  const override = activePriceOverride(account, now);
  if (!override) return null;
  const parts: string[] = [];
  if (override.platformFeeCents !== undefined) {
    parts.push(`platform fee €${(override.platformFeeCents / 100).toFixed(2)}`);
  }
  if (override.includedActiveMembers !== undefined) {
    parts.push(`${override.includedActiveMembers} included members`);
  }
  if (override.additionalMemberCents !== undefined) {
    parts.push(`extra members €${(override.additionalMemberCents / 100).toFixed(2)}`);
  }
  if (override.meteredDiscountPercent !== undefined) {
    parts.push(`${override.meteredDiscountPercent}% metered discount`);
  }
  const expiry = account.priceOverrideExpiresAt
    ? ` through ${account.priceOverrideExpiresAt.toISOString().slice(0, 10)} UTC`
    : '';
  return `Custom pricing: ${parts.join(', ')}${expiry}.`;
}

export function checkoutDiscountId(input: {
  account: BillingOperatorAccount;
  submittedCode?: string;
  envDiscountId?: string;
  envDiscountCode?: string;
  now?: Date;
}): { discountId?: string; error?: string } {
  const teamDiscount = activePolarDiscountId(input.account, input.now ?? new Date());
  if (teamDiscount) return { discountId: teamDiscount };
  const submitted = input.submittedCode?.trim();
  if (!submitted) return {};
  const expected = input.envDiscountCode?.trim();
  if (!expected || !input.envDiscountId || submitted.toLowerCase() !== expected.toLowerCase()) {
    return { error: 'That discount code is not valid.' };
  }
  return { discountId: input.envDiscountId };
}

export function billingOperatorSnapshot(account: BillingOperatorAccount): BillingOperatorSnapshot {
  return {
    arrangement: account.arrangement === 'comped' ? 'comped' : 'standard',
    planId: account.planId,
    billingState: account.billingState,
    spendCapCents: account.spendCapCents,
    compReason: account.compReason ?? null,
    compExpiresAt: account.compExpiresAt ? account.compExpiresAt.toISOString() : null,
    priceOverride: account.priceOverride ?? null,
    priceOverrideExpiresAt: account.priceOverrideExpiresAt
      ? account.priceOverrideExpiresAt.toISOString()
      : null,
    enterprisePlatformFeeCents: account.enterprisePlatformFeeCents ?? null,
    pendingEnterpriseTerms: account.pendingEnterpriseTerms ?? null,
    polarDiscountId: account.polarDiscountId ?? null,
    polarDiscountExpiresAt: account.polarDiscountExpiresAt
      ? account.polarDiscountExpiresAt.toISOString()
      : null,
  };
}

export function parseOperatorExpiry(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return new Date(`${trimmed}T23:59:59.999Z`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Expiry must be a YYYY-MM-DD date or an ISO timestamp.');
  }
  return parsed;
}

export function assertFutureExpiry(expiresAt: Date | null, now = new Date()): void {
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new Error('Expiry must be in the future.');
  }
}

const PRICE_OVERRIDE_KEYS = [
  'platformFeeCents',
  'includedActiveMembers',
  'additionalMemberCents',
  'meteredDiscountPercent',
] as const;

export function assertPriceOverride(override: TeamPriceOverride): TeamPriceOverride {
  const next: TeamPriceOverride = {};
  if (override.platformFeeCents !== undefined) {
    if (!Number.isInteger(override.platformFeeCents) || override.platformFeeCents < 0) {
      throw new Error('Platform fee must be a non-negative integer number of cents.');
    }
    next.platformFeeCents = override.platformFeeCents;
  }
  if (override.includedActiveMembers !== undefined) {
    if (!Number.isInteger(override.includedActiveMembers) || override.includedActiveMembers < 0) {
      throw new Error('Included members must be a non-negative integer.');
    }
    next.includedActiveMembers = override.includedActiveMembers;
  }
  if (override.additionalMemberCents !== undefined) {
    if (!Number.isInteger(override.additionalMemberCents) || override.additionalMemberCents < 0) {
      throw new Error('Per-member price must be a non-negative integer number of cents.');
    }
    next.additionalMemberCents = override.additionalMemberCents;
  }
  if (override.meteredDiscountPercent !== undefined) {
    if (
      !Number.isInteger(override.meteredDiscountPercent) ||
      override.meteredDiscountPercent < 0 ||
      override.meteredDiscountPercent > 100
    ) {
      throw new Error('Metered discount percent must be an integer from 0 to 100.');
    }
    next.meteredDiscountPercent = override.meteredDiscountPercent;
  }
  if (!PRICE_OVERRIDE_KEYS.some((key) => next[key] !== undefined)) {
    throw new Error('Set at least one price field.');
  }
  return next;
}

/** Checkout links the operator may open. Rejects anything that is not Polar. */
export function polarCheckoutUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'polar.sh' && !host.endsWith('.polar.sh')) return null;
  return url;
}

export function isBillingPlanId(value: string): value is BillingPlanId {
  return value in PLAN_CATALOG;
}
