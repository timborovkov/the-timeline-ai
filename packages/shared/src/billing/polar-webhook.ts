import {
  billingFreeGrants,
  billingUnbilledAlerts,
  billingUsageLedger,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

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

function enterpriseOverrideFromPending(pending: PendingEnterpriseTerms) {
  return assertPriceOverride({
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
}

async function upsertPaidSubscription(input: {
  db: Db;
  teamId: string;
  plan: PolarPaidPlanId;
  billingState: TeamBillingState;
  data: PolarWebhookPayload['data'];
  chargesEnabled: boolean;
}): Promise<{ applied: boolean }> {
  return input.db.transaction(async (tx) => {
    const existing = await lockBillingAccount(tx as unknown as Db, input.teamId);
    if (existing?.arrangement === 'comped') return { applied: false };
    const existingEnterprise =
      existing?.planId === 'enterprise' || existing?.billingState === 'enterprise_active';
    if (existingEnterprise && input.plan !== 'enterprise') return { applied: false };
    const polarSubscriptionId = input.data?.id ?? null;
    const period = polarSubscriptionPeriod(input.data);
    if (
      !shouldApplyPaidSubscriptionUpdate({
        existing,
        incomingSubscriptionId: polarSubscriptionId,
        incomingPeriodStartedAt: period.periodStartedAt,
        incomingModifiedAt: polarEventModifiedAt(input.data),
      })
    ) {
      return { applied: false };
    }
    const checkoutId = polarCheckoutId(input.data);
    const pending =
      input.plan === 'enterprise'
        ? pendingEnterpriseTermsForCheckout(existing?.pendingEnterpriseTerms ?? null, checkoutId)
        : null;
    const activatedOverride = pending ? enterpriseOverrideFromPending(pending) : null;
    const pendingAfterActivation =
      input.plan === 'enterprise' && pending
        ? pendingEnterpriseTermsAfterActivation(
            existing?.pendingEnterpriseTerms ?? null,
            checkoutId,
          )
        : undefined;
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

    await tx
      .insert(teamBillingAccounts)
      .values({
        teamId: input.teamId,
        planId: input.plan,
        billingState: input.billingState,
        polarCustomerId: polarCustomerId(input.data),
        polarSubscriptionId,
        polarProductId: input.data?.product_id ?? null,
        spendCapCents: PLAN_CATALOG[input.plan].defaultSpendCapCents,
        includedDiscountRemainingCents: included,
        periodStartedAt,
        ...(periodEndsAt ? { periodEndsAt } : {}),
        polarEventModifiedAt: polarEventModifiedAtValue,
        shadowBilling: !input.chargesEnabled,
      })
      .onConflictDoUpdate({
        target: [teamBillingAccounts.teamId],
        set: {
          planId: input.plan,
          billingState: input.billingState,
          polarCustomerId: polarCustomerId(input.data),
          polarSubscriptionId,
          polarProductId: input.data?.product_id ?? null,
          shadowBilling: !input.chargesEnabled,
          periodStartedAt,
          ...(periodEndsAt ? { periodEndsAt } : {}),
          ...(resetDiscount ? { includedDiscountRemainingCents: included } : {}),
          spendCapCents:
            pending?.spendCapCents ??
            spendCapCentsForPaidActivation({
              existing,
              plan: input.plan,
            }),
          ...(activatedOverride
            ? {
                priceOverride: activatedOverride,
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
    await recordBillingPlan(tx as unknown as Db, input.teamId, input.plan, now);
    return { applied: true };
  });
}

async function cancelMatchingSubscription(input: {
  db: Db;
  teamId: string;
  subscriptionId: string | undefined;
  incomingModifiedAt: Date | null;
}): Promise<void> {
  if (!input.subscriptionId) return;
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
    await tx
      .update(teamBillingAccounts)
      .set({
        billingState: grant ? 'free' : 'restricted',
        planId: 'free',
        spendCapCents: grant ? PLAN_CATALOG.free.defaultSpendCapCents : 0,
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
    await recordBillingPlan(tx as unknown as Db, input.teamId, 'free');
  });
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
}): Promise<{ ok: true; ignored?: string }> {
  const teamId = teamIdFromPayload(input.payload);
  if (!teamId) return { ok: true, ignored: 'missing_external_customer' };

  const type = input.payload.type ?? '';
  const data = input.payload.data;
  const plan = planFromPolarProductId(data?.product_id, input.products);

  if (
    type === 'subscription.created' ||
    type === 'subscription.active' ||
    type === 'subscription.updated'
  ) {
    if (plan) {
      const billingState = billingStateFromPolarSubscriptionStatus(plan, data?.status);
      if (billingState === 'canceled') {
        await cancelMatchingSubscription({
          db: input.db,
          teamId,
          subscriptionId: data?.id,
          incomingModifiedAt: polarEventModifiedAt(data),
        });
      } else if (billingState !== 'ignore') {
        const result = await upsertPaidSubscription({
          db: input.db,
          teamId,
          plan,
          billingState,
          data,
          chargesEnabled: input.chargesEnabled,
        });
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
    await cancelMatchingSubscription({
      db: input.db,
      teamId,
      subscriptionId: data?.id,
      incomingModifiedAt: polarEventModifiedAt(data),
    });
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
