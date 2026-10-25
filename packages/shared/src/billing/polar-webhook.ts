import {
  billingFreeGrants,
  billingUnbilledAlerts,
  billingUsageLedger,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { and, eq, isNotNull, isNull, lte, ne } from 'drizzle-orm';

import type { BillingProvider } from '#src/billing/provider.js';

import { notifySubscriptionPastDue } from '#src/billing/alerts.js';
import { PLAN_CATALOG, type BillingPlanId } from '#src/billing/catalog.js';
import {
  assertPriceOverride,
  pendingEnterpriseTermsAfterActivation,
  pendingEnterpriseTermsForCheckout,
  type PendingEnterpriseTerms,
} from '#src/billing/operator.js';
import { recordBillingPlan } from '#src/billing/plan-history.js';
import { TIMELINE_TOPUP_PRODUCT_NAME } from '#src/billing/polar-setup.js';
import { childLogger } from '#src/logger.js';

export type PolarPaidPlanId = 'payg' | 'team' | 'business' | 'enterprise';

export interface PolarWebhookPayload {
  type?: string;
  data?: {
    id?: string;
    status?: string;
    product_id?: string;
    amount?: number;
    refunded_amount?: number;
    refundedAmount?: number;
    current_period_start?: string | number;
    current_period_end?: string | number;
    currentPeriodStart?: string | number;
    currentPeriodEnd?: string | number;
    /** True while Polar will revoke access at the end of the paid period. */
    cancel_at_period_end?: boolean;
    cancelAtPeriodEnd?: boolean;
    /** When Polar will revoke access. Absent on a subscription that renews. */
    ends_at?: string | number | null;
    endsAt?: string | number | null;
    modified_at?: string | number;
    updated_at?: string | number;
    modifiedAt?: string | number;
    updatedAt?: string | number;
    customer?: { external_id?: string; id?: string };
    customer_id?: string;
    external_customer_id?: string;
    checkout_id?: string;
    checkoutId?: string;
    checkout?: { id?: string };
    order_id?: string;
    orderId?: string;
    billing_reason?: string;
    billingReason?: string;
    product_name?: string;
    product?: {
      id?: string;
      name?: string;
      is_recurring?: boolean;
      isRecurring?: boolean;
    };
  };
}

export interface PolarWebhookProductIds {
  payg?: string;
  team?: string;
  business?: string;
  enterprise?: string;
  /** Retired one-time product id, used only to recognize a stray paid order. */
  topup?: string;
}

export const RETIRED_TOPUP_ALERT_REASON_PREFIX = 'retired_topup_paid:';

/** One open alert per extra Polar subscription id. Replay does not insert another. */
export const DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX = 'duplicate_polar_subscription:';
export const COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX = 'comped_polar_subscription:';

const REPLACED_SUBSCRIPTION_NOT_LIVE = new Set(['canceled', 'deletion_scheduled']);

const log = childLogger('billing:polar-webhook');

type TeamBillingState = (typeof teamBillingAccounts.$inferSelect)['billingState'];

export function planFromPolarProductId(
  productId: string | undefined,
  products: PolarWebhookProductIds,
): PolarPaidPlanId | null {
  if (!productId) return null;
  if (products.payg && productId === products.payg) return 'payg';
  if (products.team && productId === products.team) return 'team';
  if (products.business && productId === products.business) return 'business';
  if (products.enterprise && productId === products.enterprise) return 'enterprise';
  return null;
}

export function parsePolarTimestamp(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function polarSubscriptionPeriod(data: PolarWebhookPayload['data']): {
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
} {
  return {
    periodStartedAt: parsePolarTimestamp(data?.current_period_start ?? data?.currentPeriodStart),
    periodEndsAt: parsePolarTimestamp(data?.current_period_end ?? data?.currentPeriodEnd),
  };
}

function polarCancelAtPeriodEnd(data: PolarWebhookPayload['data']): boolean | null {
  if (!data) return null;
  if (typeof data.cancel_at_period_end === 'boolean') return data.cancel_at_period_end;
  if (typeof data.cancelAtPeriodEnd === 'boolean') return data.cancelAtPeriodEnd;
  return null;
}

/**
 * When this cancel stops paid access. `ends_at` is Polar's revocation time.
 * `current_period_end` counts only when Polar set `cancel_at_period_end`,
 * because a renewing subscription also has a period end.
 */
export function polarScheduledCancellationEnd(data: PolarWebhookPayload['data']): Date | null {
  const explicit = parsePolarTimestamp(data?.ends_at ?? data?.endsAt);
  if (explicit) return explicit;
  if (polarCancelAtPeriodEnd(data) !== true) return null;
  return parsePolarTimestamp(data?.current_period_end ?? data?.currentPeriodEnd);
}

function polarCancellationWasRequested(input: {
  type: string;
  data: PolarWebhookPayload['data'];
}): boolean {
  if (input.type === 'subscription.canceled' || input.type === 'subscription.revoked') return true;
  const status = (input.data?.status ?? '').trim().toLowerCase();
  if (status === 'canceled' || status === 'revoked') return true;
  if (polarCancelAtPeriodEnd(input.data) === true) return true;
  return parsePolarTimestamp(input.data?.ends_at ?? input.data?.endsAt) !== null;
}

/** Paid access continues through a period-end cancel that has not taken effect. */
export function polarCancellationKeepsPaidAccess(input: {
  type: string;
  data: PolarWebhookPayload['data'];
  now?: Date;
}): boolean {
  const status = (input.data?.status ?? '').trim().toLowerCase();
  if (input.type === 'subscription.revoked' || status === 'revoked') return false;
  if (!polarCancellationWasRequested(input)) return false;
  const now = input.now ?? new Date();
  const end = polarScheduledCancellationEnd(input.data);
  if (end) return end.getTime() > now.getTime();
  return polarCancelAtPeriodEnd(input.data) === true;
}

function polarCancellationEndsPaidAccess(input: {
  type: string;
  data: PolarWebhookPayload['data'];
  now?: Date;
}): boolean {
  const status = (input.data?.status ?? '').trim().toLowerCase();
  if (input.type === 'subscription.revoked' || status === 'revoked') return true;
  if (!polarCancellationWasRequested(input)) return false;
  return !polarCancellationKeepsPaidAccess(input);
}

/** An explicit active subscription with the cancel cleared. Omitted fields do not. */
function polarPayloadClearsScheduledCancel(data: PolarWebhookPayload['data']): boolean {
  if (polarCancelAtPeriodEnd(data) === false) return true;
  if (!data || !('ends_at' in data || 'endsAt' in data)) return false;
  if (polarScheduledCancellationEnd(data) !== null) return false;
  const status = (data.status ?? 'active').trim().toLowerCase();
  return status === 'active' || status === 'trialing';
}

export function spendCapCentsForPaidActivation(input: {
  existing: typeof teamBillingAccounts.$inferSelect | undefined;
  plan: PolarPaidPlanId;
}): number {
  const catalogDefault = PLAN_CATALOG[input.plan].defaultSpendCapCents;
  // Only Free → paid activation synthesizes a catalog default. Paid accounts
  // keep an administrator-selected cap, including €0 as a hard stop.
  if (!input.existing || input.existing.planId === 'free') return catalogDefault;
  return input.existing.spendCapCents;
}

const ACTIVE_PAID_BILLING_STATES = new Set<TeamBillingState>([
  'payg_active',
  'team_active',
  'business_active',
  'enterprise_active',
]);

/**
 * Polar "active" means the subscription is in good standing with Polar.
 * `past_due` and `payment_retry` still follow the incoming status, so a later
 * active event clears a failed-payment pause.
 *
 * This invoice branch has no wallet. `preserveLocalFreeze` keeps a spend-cap
 * settlement freeze (`read_only` / `balance_exhausted`) across that active
 * update. Raising the spend cap remains the recovery. A historical wallet
 * shortfall row is not a freeze signal here (`outstandingDebtCents` stays 0).
 * The wallet branch passes the unpaid shortfall instead and does not preserve
 * a spend-cap-only freeze once that debt is gone.
 */
export function billingStateForPolarSubscriptionUpsert(input: {
  incoming: TeamBillingState;
  existingState: string | null | undefined;
  outstandingDebtCents: number;
  preserveLocalFreeze?: boolean;
}): TeamBillingState {
  if (!ACTIVE_PAID_BILLING_STATES.has(input.incoming)) return input.incoming;
  const localFreeze =
    input.existingState === 'read_only' || input.existingState === 'balance_exhausted'
      ? input.existingState
      : null;
  if (input.outstandingDebtCents > 0) return localFreeze ?? 'read_only';
  if (input.preserveLocalFreeze && localFreeze) return localFreeze;
  return input.incoming;
}

export function billingStateForPolarPlan(plan: PolarPaidPlanId) {
  switch (plan) {
    case 'payg':
      return 'payg_active' as const;
    case 'team':
      return 'team_active' as const;
    case 'business':
      return 'business_active' as const;
    case 'enterprise':
      return 'enterprise_active' as const;
  }
}

/** Map Polar subscription.status instead of activating from product id alone. */
export function billingStateFromPolarSubscriptionStatus(
  plan: PolarPaidPlanId,
  status: string | undefined,
): TeamBillingState | 'ignore' {
  const normalized = (status ?? 'active').trim().toLowerCase();
  switch (normalized) {
    case 'active':
    case 'trialing':
      return billingStateForPolarPlan(plan);
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
    case 'incomplete_expired':
      return 'payment_retry';
    case 'canceled':
    case 'revoked':
      return 'canceled';
    default:
      return 'ignore';
  }
}

export function shouldResetIncludedDiscount(input: {
  existing: typeof teamBillingAccounts.$inferSelect | undefined;
  planId: BillingPlanId;
  polarSubscriptionId: string | null;
  periodStartedAt?: Date | null;
  periodEndsAt: Date | null;
}): boolean {
  if (!input.existing) return true;
  if (input.existing.planId !== input.planId) return true;
  if (input.existing.polarSubscriptionId !== input.polarSubscriptionId) return true;
  if (input.periodStartedAt && input.existing.periodStartedAt) {
    return input.periodStartedAt.getTime() > input.existing.periodStartedAt.getTime();
  }
  if (!input.periodEndsAt) return false;
  if (!input.existing.periodEndsAt) return true;
  return input.periodEndsAt.getTime() > input.existing.periodEndsAt.getTime();
}

export function polarEventModifiedAt(data: PolarWebhookPayload['data']): Date | null {
  return parsePolarTimestamp(
    data?.modified_at ?? data?.updated_at ?? data?.modifiedAt ?? data?.updatedAt,
  );
}

/**
 * Ignore delayed activations of an older subscription after a newer one is
 * stored, and ignore stale active events whose Polar timestamp is older than
 * the last Polar event applied to this row.
 */
export function shouldApplyPaidSubscriptionUpdate(input: {
  existing: typeof teamBillingAccounts.$inferSelect | undefined;
  incomingSubscriptionId: string | null;
  incomingPeriodStartedAt: Date | null;
  incomingModifiedAt: Date | null;
}): boolean {
  if (!input.existing) return true;
  const incomingId = input.incomingSubscriptionId;
  if (!incomingId) return true;
  const existingId = input.existing.polarSubscriptionId;
  const existingPolarClock = input.existing.polarEventModifiedAt;
  if (input.incomingModifiedAt && existingPolarClock) {
    if (input.incomingModifiedAt.getTime() < existingPolarClock.getTime()) {
      return false;
    }
  }
  if (!existingId || existingId === incomingId) return true;
  const existingStart = input.existing.periodStartedAt?.getTime() ?? 0;
  const incomingStart = input.incomingPeriodStartedAt?.getTime() ?? 0;
  if (incomingStart > 0 && existingStart > 0) {
    return incomingStart >= existingStart;
  }
  return (
    input.existing.planId === 'free' ||
    input.existing.billingState === 'restricted' ||
    input.existing.billingState === 'canceled'
  );
}

function polarCustomerId(data: PolarWebhookPayload['data']): string | null {
  return data?.customer?.id ?? data?.customer_id ?? null;
}

/** Checkout that created this subscription, when Polar includes it. */
function polarCheckoutId(data: PolarWebhookPayload['data']): string | null {
  const raw = data?.checkout_id ?? data?.checkoutId ?? data?.checkout?.id ?? null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function teamIdFromPayload(payload: PolarWebhookPayload): string | null {
  return payload.data?.customer?.external_id ?? payload.data?.external_customer_id ?? null;
}

async function lockBillingAccount(db: Db, teamId: string) {
  const [row] = await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId))
    .limit(1)
    .for('update');
  return row;
}

function enterpriseActivationPricing(pending: PendingEnterpriseTerms): {
  platformFeeCents: number;
  priceOverride: ReturnType<typeof assertPriceOverride> | null;
} {
  const validated = assertPriceOverride({
    platformFeeCents: pending.platformFeeCents,
    ...(pending.includedActiveMembers !== undefined
      ? { includedActiveMembers: pending.includedActiveMembers }
      : {}),
    ...(pending.additionalMemberCents !== undefined
      ? { additionalMemberCents: pending.additionalMemberCents }
      : {}),
    ...(pending.meteredDiscountPercent !== undefined
      ? { meteredDiscountPercent: pending.meteredDiscountPercent }
      : {}),
  });
  const priceOverride: ReturnType<typeof assertPriceOverride> = {};
  if (validated.includedActiveMembers !== undefined) {
    priceOverride.includedActiveMembers = validated.includedActiveMembers;
  }
  if (validated.additionalMemberCents !== undefined) {
    priceOverride.additionalMemberCents = validated.additionalMemberCents;
  }
  if (validated.meteredDiscountPercent !== undefined) {
    priceOverride.meteredDiscountPercent = validated.meteredDiscountPercent;
  }
  return {
    platformFeeCents: validated.platformFeeCents ?? pending.platformFeeCents,
    priceOverride:
      priceOverride.includedActiveMembers !== undefined ||
      priceOverride.additionalMemberCents !== undefined ||
      priceOverride.meteredDiscountPercent !== undefined
        ? priceOverride
        : null,
  };
}

interface DuplicateSubscription {
  keptSubscriptionId: string;
  extraSubscriptionId: string;
}

/** A paid subscription that arrived after the workspace was already comped. */
interface CompedIncomingSubscription {
  subscriptionId: string;
  /** Clear this id after a successful revoke. A different stored id stays. */
  clearStoredId: boolean;
}

function liveTrackedSubscriptionId(
  existing: typeof teamBillingAccounts.$inferSelect | undefined,
  incomingSubscriptionId: string | null,
): string | null {
  if (!existing || !incomingSubscriptionId) return null;
  const tracked = existing.polarSubscriptionId;
  if (!tracked || tracked === incomingSubscriptionId) return null;
  if (REPLACED_SUBSCRIPTION_NOT_LIVE.has(existing.billingState)) return null;
  return tracked;
}

async function upsertPaidSubscription(input: {
  db: Db;
  teamId: string;
  plan: PolarPaidPlanId;
  billingState: TeamBillingState;
  data: PolarWebhookPayload['data'];
  chargesEnabled: boolean;
  /** `null` clears a scheduled period-end cancel. Omit to leave the stored end. */
  cancelEffectiveAt?: Date | null;
}): Promise<{
  applied: boolean;
  duplicate?: DuplicateSubscription;
  compedIncoming?: CompedIncomingSubscription;
}> {
  return input.db.transaction(async (tx) => {
    const existing = await lockBillingAccount(tx as unknown as Db, input.teamId);
    if (existing?.arrangement === 'comped') {
      return recordCompedIncomingSubscription(tx as unknown as Db, existing, input.data);
    }
    const polarSubscriptionId = input.data?.id ?? null;
    const trackedSubscriptionId = liveTrackedSubscriptionId(existing, polarSubscriptionId);
    const existingEnterprise =
      existing?.planId === 'enterprise' || existing?.billingState === 'enterprise_active';
    if (existingEnterprise && input.plan !== 'enterprise') {
      if (trackedSubscriptionId && polarSubscriptionId) {
        return {
          applied: false,
          duplicate: {
            keptSubscriptionId: trackedSubscriptionId,
            extraSubscriptionId: polarSubscriptionId,
          },
        };
      }
      return { applied: false };
    }
    const period = polarSubscriptionPeriod(input.data);
    if (
      !shouldApplyPaidSubscriptionUpdate({
        existing,
        incomingSubscriptionId: polarSubscriptionId,
        incomingPeriodStartedAt: period.periodStartedAt,
        incomingModifiedAt: polarEventModifiedAt(input.data),
      })
    ) {
      if (trackedSubscriptionId && polarSubscriptionId) {
        return {
          applied: false,
          duplicate: {
            keptSubscriptionId: trackedSubscriptionId,
            extraSubscriptionId: polarSubscriptionId,
          },
        };
      }
      return { applied: false };
    }
    const checkoutId = polarCheckoutId(input.data);
    const pending =
      input.plan === 'enterprise'
        ? pendingEnterpriseTermsForCheckout(existing?.pendingEnterpriseTerms ?? null, checkoutId)
        : null;
    const activatedPricing = pending ? enterpriseActivationPricing(pending) : null;
    const pendingAfterActivation =
      input.plan === 'enterprise' && pending
        ? pendingEnterpriseTermsAfterActivation(
            existing?.pendingEnterpriseTerms ?? null,
            checkoutId,
          )
        : undefined;
    const billingState = billingStateForPolarSubscriptionUpsert({
      incoming: input.billingState,
      existingState: existing?.billingState,
      outstandingDebtCents: 0,
      preserveLocalFreeze: true,
    });
    const included = PLAN_CATALOG[input.plan].includedUsageDiscountCents;
    const resetDiscount = shouldResetIncludedDiscount({
      existing,
      planId: input.plan,
      polarSubscriptionId,
      periodStartedAt: period.periodStartedAt,
      periodEndsAt: period.periodEndsAt,
    });
    const now = new Date();
    const periodStartedAt = period.periodStartedAt ?? existing?.periodStartedAt ?? now;
    const periodEndsAt = period.periodEndsAt ?? existing?.periodEndsAt ?? null;
    const polarEventModifiedAtValue =
      polarEventModifiedAt(input.data) ?? existing?.polarEventModifiedAt ?? now;
    const scheduledCancel =
      input.cancelEffectiveAt !== undefined ? { cancelEffectiveAt: input.cancelEffectiveAt } : {};

    await tx
      .insert(teamBillingAccounts)
      .values({
        teamId: input.teamId,
        planId: input.plan,
        billingState,
        polarCustomerId: polarCustomerId(input.data),
        polarSubscriptionId,
        polarProductId: input.data?.product_id ?? null,
        spendCapCents: PLAN_CATALOG[input.plan].defaultSpendCapCents,
        includedDiscountRemainingCents: included,
        periodStartedAt,
        ...(periodEndsAt ? { periodEndsAt } : {}),
        ...scheduledCancel,
        polarEventModifiedAt: polarEventModifiedAtValue,
        shadowBilling: !input.chargesEnabled,
      })
      .onConflictDoUpdate({
        target: [teamBillingAccounts.teamId],
        set: {
          planId: input.plan,
          billingState,
          polarCustomerId: polarCustomerId(input.data),
          polarSubscriptionId,
          polarProductId: input.data?.product_id ?? null,
          shadowBilling: !input.chargesEnabled,
          periodStartedAt,
          ...(periodEndsAt ? { periodEndsAt } : {}),
          ...scheduledCancel,
          ...(resetDiscount ? { includedDiscountRemainingCents: included } : {}),
          spendCapCents:
            pending?.spendCapCents ??
            spendCapCentsForPaidActivation({
              existing,
              plan: input.plan,
            }),
          ...(input.plan === 'enterprise' ? {} : { enterprisePlatformFeeCents: null }),
          ...(activatedPricing
            ? {
                enterprisePlatformFeeCents: activatedPricing.platformFeeCents,
                priceOverride: activatedPricing.priceOverride,
                priceOverrideExpiresAt: null,
              }
            : {}),
          ...(pendingAfterActivation !== undefined
            ? { pendingEnterpriseTerms: pendingAfterActivation }
            : {}),
          polarEventModifiedAt: polarEventModifiedAtValue,
          updatedAt: now,
        },
      });
    await recordBillingPlan(
      tx as unknown as Db,
      input.teamId,
      input.plan,
      now,
      existing ? { planId: existing.planId, effectiveAt: existing.createdAt } : undefined,
    );
    if (trackedSubscriptionId && polarSubscriptionId) {
      return {
        applied: true,
        duplicate: {
          keptSubscriptionId: polarSubscriptionId,
          extraSubscriptionId: trackedSubscriptionId,
        },
      };
    }
    return { applied: true };
  });
}

/**
 * Keep the comp. Remember the incoming subscription until Polar revoke
 * succeeds, and drop the checkout that produced it from pending terms.
 */
async function recordCompedIncomingSubscription(
  db: Db,
  existing: typeof teamBillingAccounts.$inferSelect,
  data: PolarWebhookPayload['data'],
): Promise<{ applied: false; compedIncoming?: CompedIncomingSubscription }> {
  const incomingSubscriptionId = data?.id ?? null;
  if (!incomingSubscriptionId) return { applied: false };
  const tracked = existing.polarSubscriptionId;
  const clearStoredId = !tracked || tracked === incomingSubscriptionId;
  const checkoutId = polarCheckoutId(data);
  const pendingAfter = checkoutId
    ? pendingEnterpriseTermsAfterActivation(existing.pendingEnterpriseTerms ?? null, checkoutId)
    : undefined;
  const customerId = polarCustomerId(data);
  await db
    .update(teamBillingAccounts)
    .set({
      ...(clearStoredId
        ? {
            polarSubscriptionId: incomingSubscriptionId,
            ...(customerId ? { polarCustomerId: customerId } : {}),
            ...(data?.product_id ? { polarProductId: data.product_id } : {}),
          }
        : {}),
      ...(pendingAfter !== undefined ? { pendingEnterpriseTerms: pendingAfter } : {}),
      updatedAt: new Date(),
    })
    .where(eq(teamBillingAccounts.teamId, existing.teamId));
  return {
    applied: false,
    compedIncoming: { subscriptionId: incomingSubscriptionId, clearStoredId },
  };
}

async function reconcileCompedIncomingSubscription(input: {
  db: Db;
  teamId: string;
  subscriptionId: string;
  clearStoredId: boolean;
  provider: BillingProvider | null;
}): Promise<void> {
  let revoked = false;
  if (input.provider) {
    try {
      await input.provider.revokeSubscription(input.subscriptionId);
      revoked = true;
    } catch (err) {
      log.warn(
        { err, teamId: input.teamId, subscriptionId: input.subscriptionId },
        'comped workspace Polar subscription revoke failed',
      );
    }
  }
  if (revoked && input.clearStoredId) {
    await input.db
      .update(teamBillingAccounts)
      .set({ polarSubscriptionId: null, polarProductId: null, updatedAt: new Date() })
      .where(
        and(
          eq(teamBillingAccounts.teamId, input.teamId),
          eq(teamBillingAccounts.arrangement, 'comped'),
          eq(teamBillingAccounts.polarSubscriptionId, input.subscriptionId),
        ),
      );
  }
  const detail = revoked
    ? `Incoming Polar subscription ${input.subscriptionId} was revoked because the workspace is comped. Refund any charge.`
    : `Incoming Polar subscription ${input.subscriptionId} is still billing a comped workspace. Revoke it in Polar and refund any charge.`;
  const reason = `${COMPED_INCOMING_SUBSCRIPTION_ALERT_REASON_PREFIX}${input.subscriptionId}`;
  const inserted = await input.db
    .insert(billingUnbilledAlerts)
    .values({
      teamId: input.teamId,
      meterId: 'subscription',
      periodYm: periodYm(),
      reason,
      detail,
    })
    .onConflictDoNothing()
    .returning({ id: billingUnbilledAlerts.id });
  if (inserted.length > 0) return;
  await input.db
    .update(billingUnbilledAlerts)
    .set({ detail })
    .where(
      and(
        eq(billingUnbilledAlerts.teamId, input.teamId),
        eq(billingUnbilledAlerts.reason, reason),
        isNull(billingUnbilledAlerts.resolvedAt),
      ),
    );
}

async function reconcileDuplicateSubscription(input: {
  db: Db;
  teamId: string;
  keptSubscriptionId: string;
  extraSubscriptionId: string;
  provider: BillingProvider | null;
}): Promise<void> {
  let revoked = false;
  if (input.provider) {
    try {
      await input.provider.revokeSubscription(input.extraSubscriptionId);
      revoked = true;
    } catch (err) {
      log.warn(
        { err, teamId: input.teamId, extraSubscriptionId: input.extraSubscriptionId },
        'duplicate Polar subscription revoke failed',
      );
    }
  }
  const detail = revoked
    ? `Extra Polar subscription ${input.extraSubscriptionId} was revoked after ${input.keptSubscriptionId} stayed the tracked subscription. Refund any duplicate charge.`
    : `Extra Polar subscription ${input.extraSubscriptionId} is still billing alongside tracked subscription ${input.keptSubscriptionId}. Revoke it in Polar and refund any duplicate charge.`;
  await input.db
    .insert(billingUnbilledAlerts)
    .values({
      teamId: input.teamId,
      meterId: 'subscription',
      periodYm: periodYm(),
      reason: `${DUPLICATE_SUBSCRIPTION_ALERT_REASON_PREFIX}${input.extraSubscriptionId}`,
      detail,
    })
    .onConflictDoNothing();
}

async function keepPaidSubscriptionUntilCancellation(input: {
  db: Db;
  teamId: string;
  subscriptionId: string | undefined;
  data: PolarWebhookPayload['data'];
  incomingModifiedAt: Date | null;
}): Promise<void> {
  if (!input.subscriptionId) return;
  const end = polarScheduledCancellationEnd(input.data);
  await input.db.transaction(async (tx) => {
    const existing = await lockBillingAccount(tx as unknown as Db, input.teamId);
    if (!existing || existing.arrangement === 'comped') return;
    if (existing.polarSubscriptionId !== input.subscriptionId) return;
    if (
      !shouldApplyPaidSubscriptionUpdate({
        existing,
        incomingSubscriptionId: input.subscriptionId,
        incomingPeriodStartedAt: existing.periodStartedAt,
        incomingModifiedAt: input.incomingModifiedAt,
      })
    ) {
      return;
    }
    await tx
      .update(teamBillingAccounts)
      .set({
        ...(end ? { cancelEffectiveAt: end, periodEndsAt: end } : {}),
        polarEventModifiedAt:
          input.incomingModifiedAt ?? existing.polarEventModifiedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(teamBillingAccounts.teamId, input.teamId),
          eq(teamBillingAccounts.polarSubscriptionId, input.subscriptionId),
        ),
      );
  });
}

async function cancelMatchingSubscription(input: {
  db: Db;
  teamId: string;
  subscriptionId: string | undefined;
  incomingModifiedAt: Date | null;
  /**
   * Maintenance sweep only. A webhook cancel still downgrades when Polar has
   * already ended access, even if the stored schedule is missing or future.
   */
  dueBy?: Date;
}): Promise<boolean> {
  if (!input.subscriptionId) return false;
  return input.db.transaction(async (tx) => {
    const existing = await lockBillingAccount(tx as unknown as Db, input.teamId);
    if (!existing || existing.arrangement === 'comped') return false;
    if (existing.polarSubscriptionId !== input.subscriptionId) return false;
    if (
      input.dueBy &&
      (!existing.cancelEffectiveAt || existing.cancelEffectiveAt.getTime() > input.dueBy.getTime())
    ) {
      return false;
    }
    if (
      !shouldApplyPaidSubscriptionUpdate({
        existing,
        incomingSubscriptionId: input.subscriptionId,
        incomingPeriodStartedAt: existing.periodStartedAt,
        incomingModifiedAt: input.incomingModifiedAt,
      })
    ) {
      return false;
    }
    const [grant] = await tx
      .select({ id: billingFreeGrants.id })
      .from(billingFreeGrants)
      .where(
        and(
          eq(billingFreeGrants.assignedTeamId, input.teamId),
          isNull(billingFreeGrants.revokedAt),
        ),
      )
      .limit(1);
    const leavingEnterprise =
      existing.planId === 'enterprise' || existing.billingState === 'enterprise_active';
    const downgradedAt = new Date();
    const [downgraded] = await tx
      .update(teamBillingAccounts)
      .set({
        billingState: grant ? 'free' : 'restricted',
        planId: 'free',
        spendCapCents: grant ? PLAN_CATALOG.free.defaultSpendCapCents : 0,
        polarSubscriptionId: null,
        polarProductId: null,
        cancelEffectiveAt: null,
        enterprisePlatformFeeCents: null,
        ...(leavingEnterprise ? { priceOverride: null, priceOverrideExpiresAt: null } : {}),
        polarEventModifiedAt:
          input.incomingModifiedAt ?? existing.polarEventModifiedAt ?? downgradedAt,
        updatedAt: downgradedAt,
      })
      .where(
        and(
          eq(teamBillingAccounts.teamId, input.teamId),
          eq(teamBillingAccounts.polarSubscriptionId, input.subscriptionId),
          ...(input.dueBy
            ? [
                isNotNull(teamBillingAccounts.cancelEffectiveAt),
                lte(teamBillingAccounts.cancelEffectiveAt, input.dueBy),
              ]
            : []),
        ),
      )
      .returning({ teamId: teamBillingAccounts.teamId });
    if (!downgraded) return false;
    await recordBillingPlan(tx as unknown as Db, input.teamId, 'free', downgradedAt, {
      planId: existing.planId,
      effectiveAt: existing.createdAt,
    });
    return true;
  });
}

/** Downgrade paid plans whose period-end cancel has arrived, without waiting for a later webhook. */
export async function applyElapsedScheduledCancellations(
  db: Db,
  now = new Date(),
  hooks?: {
    /** Test seam for a webhook that commits after the due-row read and before the lock. */
    afterSelect?: () => Promise<void>;
  },
): Promise<number> {
  const due = await db
    .select({
      teamId: teamBillingAccounts.teamId,
      polarSubscriptionId: teamBillingAccounts.polarSubscriptionId,
    })
    .from(teamBillingAccounts)
    .where(
      and(
        isNotNull(teamBillingAccounts.cancelEffectiveAt),
        lte(teamBillingAccounts.cancelEffectiveAt, now),
        isNotNull(teamBillingAccounts.polarSubscriptionId),
        ne(teamBillingAccounts.arrangement, 'comped'),
      ),
    );
  if (hooks?.afterSelect) await hooks.afterSelect();
  let applied = 0;
  for (const row of due) {
    if (!row.polarSubscriptionId) continue;
    const downgraded = await cancelMatchingSubscription({
      db,
      teamId: row.teamId,
      subscriptionId: row.polarSubscriptionId,
      incomingModifiedAt: null,
      dueBy: now,
    });
    if (downgraded) applied += 1;
  }
  return applied;
}

/**
 * A paid one-time order that is not a subscription product. New checkouts for
 * the retired top-up are gone; an order Polar already collected still has to
 * be recorded.
 */
export function isRetiredPaidTopupOrder(input: {
  data: PolarWebhookPayload['data'];
  products: PolarWebhookProductIds;
}): boolean {
  const data = input.data;
  if (!data) return false;
  const productId = data.product_id ?? data.product?.id;
  const name = (data.product?.name ?? data.product_name ?? '').trim();
  if (input.products.topup && productId === input.products.topup) return true;
  if (name === TIMELINE_TOPUP_PRODUCT_NAME) return true;
  if (planFromPolarProductId(productId, input.products)) return false;
  const reason = (data.billing_reason ?? data.billingReason ?? '').trim().toLowerCase();
  if (reason === 'purchase') return true;
  const recurring = data.product?.is_recurring ?? data.product?.isRecurring;
  return recurring === false && Boolean(productId);
}

function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function recordRetiredPaidTopup(input: {
  db: Db;
  teamId: string;
  data: NonNullable<PolarWebhookPayload['data']>;
}): Promise<void> {
  const orderId = input.data.id ?? `anon:${input.teamId}`;
  const cents =
    typeof input.data.amount === 'number' &&
    Number.isInteger(input.data.amount) &&
    input.data.amount > 0
      ? input.data.amount
      : 0;
  const productId = input.data.product_id ?? input.data.product?.id ?? null;
  const operationId = `polar_topup:${orderId}`;
  const detail = `Paid retired top-up order ${orderId} for ${String(cents)} cents${
    productId ? ` (product ${productId})` : ''
  }. Recorded only. The wallet balance was not credited. Refund the order in Polar.`;
  await input.db.transaction(async (tx) => {
    const [ledger] = await tx
      .insert(billingUsageLedger)
      .values({
        teamId: input.teamId,
        operationId,
        kind: 'top_up',
        meterId: 'ai',
        nativeUnits: '0',
        customerChargeCents: 0,
        billable: false,
        nonBillableReason: 'retired_topup',
        operationClass: 'retired_topup',
        source: 'polar_order',
        metadata: {
          cents,
          order_id: orderId,
          wallet_credited: false,
          ...(productId ? { product_id: productId } : {}),
        },
      })
      .onConflictDoNothing()
      .returning({ id: billingUsageLedger.id });
    await tx
      .insert(billingUnbilledAlerts)
      .values({
        teamId: input.teamId,
        meterId: 'top_up',
        periodYm: periodYm(),
        reason: `${RETIRED_TOPUP_ALERT_REASON_PREFIX}${orderId}`,
        detail,
      })
      .onConflictDoNothing();
    if (ledger) {
      log.warn(
        { teamId: input.teamId, orderId, cents },
        'retired top-up payment recorded; wallet not credited',
      );
    }
  });
}

export async function handlePolarWebhookEvent(input: {
  db: Db;
  payload: PolarWebhookPayload;
  chargesEnabled: boolean;
  products: PolarWebhookProductIds;
  /** Revokes an extra live subscription. Missing provider still alerts. */
  provider?: BillingProvider | null;
}): Promise<{ ok: true; ignored?: string }> {
  const teamId = teamIdFromPayload(input.payload);
  if (!teamId) return { ok: true, ignored: 'missing_external_customer' };

  const type = input.payload.type ?? '';
  const data = input.payload.data;
  const plan = planFromPolarProductId(data?.product_id, input.products);
  const now = new Date();
  const cancellation = { type, data, now };

  if (
    type === 'subscription.created' ||
    type === 'subscription.active' ||
    type === 'subscription.updated'
  ) {
    if (plan) {
      const billingState = billingStateFromPolarSubscriptionStatus(plan, data?.status);
      if (polarCancellationEndsPaidAccess(cancellation)) {
        await cancelMatchingSubscription({
          db: input.db,
          teamId,
          subscriptionId: data?.id,
          incomingModifiedAt: polarEventModifiedAt(data),
        });
      } else if (billingState === 'canceled') {
        await keepPaidSubscriptionUntilCancellation({
          db: input.db,
          teamId,
          subscriptionId: data?.id,
          data,
          incomingModifiedAt: polarEventModifiedAt(data),
        });
      } else if (billingState !== 'ignore') {
        const scheduledEnd = polarCancellationKeepsPaidAccess(cancellation)
          ? (polarScheduledCancellationEnd(data) ?? undefined)
          : polarPayloadClearsScheduledCancel(data)
            ? null
            : undefined;
        const result = await upsertPaidSubscription({
          db: input.db,
          teamId,
          plan,
          billingState,
          data,
          chargesEnabled: input.chargesEnabled,
          ...(scheduledEnd !== undefined ? { cancelEffectiveAt: scheduledEnd } : {}),
        });
        if (result.compedIncoming) {
          await reconcileCompedIncomingSubscription({
            db: input.db,
            teamId,
            subscriptionId: result.compedIncoming.subscriptionId,
            clearStoredId: result.compedIncoming.clearStoredId,
            provider: input.provider ?? null,
          });
        }
        if (result.duplicate) {
          await reconcileDuplicateSubscription({
            db: input.db,
            teamId,
            keptSubscriptionId: result.duplicate.keptSubscriptionId,
            extraSubscriptionId: result.duplicate.extraSubscriptionId,
            provider: input.provider ?? null,
          });
        }
        if (result.applied && billingState === 'past_due') {
          try {
            await notifySubscriptionPastDue({
              db: input.db,
              teamId,
              planId: plan,
            });
          } catch (err) {
            log.warn({ err, teamId }, 'past_due billing alert failed');
          }
        }
      }
    }
  }

  if (type === 'subscription.canceled' || type === 'subscription.revoked') {
    if (polarCancellationEndsPaidAccess(cancellation)) {
      await cancelMatchingSubscription({
        db: input.db,
        teamId,
        subscriptionId: data?.id,
        incomingModifiedAt: polarEventModifiedAt(data),
      });
    } else {
      await keepPaidSubscriptionUntilCancellation({
        db: input.db,
        teamId,
        subscriptionId: data?.id,
        data,
        incomingModifiedAt: polarEventModifiedAt(data),
      });
    }
  }

  if (
    type === 'order.paid' &&
    data &&
    isRetiredPaidTopupOrder({ data, products: input.products })
  ) {
    await recordRetiredPaidTopup({ db: input.db, teamId, data });
  }

  return { ok: true };
}
