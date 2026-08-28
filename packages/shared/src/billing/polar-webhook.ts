import { billingFreeGrants, teamBillingAccounts, type Db } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

import { PLAN_CATALOG, PREPAID_TOPUP_CENTS, type BillingPlanId } from '#src/billing/catalog.js';
import { creditWalletFromPolarOrder, debitWalletFromPolarRefund } from '#src/billing/runtime.js';

export type PolarPaidPlanId = 'payg' | 'team' | 'business';

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
    order_id?: string;
    orderId?: string;
  };
}

export interface PolarWebhookProductIds {
  payg?: string;
  team?: string;
  business?: string;
  topup?: string;
}

type TeamBillingState = (typeof teamBillingAccounts.$inferSelect)['billingState'];

export function planFromPolarProductId(
  productId: string | undefined,
  products: PolarWebhookProductIds,
): PolarPaidPlanId | null {
  if (!productId) return null;
  if (products.payg && productId === products.payg) return 'payg';
  if (products.team && productId === products.team) return 'team';
  if (products.business && productId === products.business) return 'business';
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

async function upsertPaidSubscription(input: {
  db: Db;
  teamId: string;
  plan: PolarPaidPlanId;
  billingState: TeamBillingState;
  data: PolarWebhookPayload['data'];
  chargesEnabled: boolean;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const existing = await lockBillingAccount(tx as unknown as Db, input.teamId);
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
      return;
    }
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
          spendCapCents: spendCapCentsForPaidActivation({
            existing,
            plan: input.plan,
          }),
          polarEventModifiedAt: polarEventModifiedAtValue,
          updatedAt: now,
        },
      });
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
    if (!existing || existing.polarSubscriptionId !== input.subscriptionId) return;
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
        await upsertPaidSubscription({
          db: input.db,
          teamId,
          plan,
          billingState,
          data,
          chargesEnabled: input.chargesEnabled,
        });
      }
    }
  }

  if (type === 'order.paid') {
    const topupProductId = input.products.topup;
    if (data && topupProductId && data.product_id === topupProductId) {
      const cents =
        typeof data.amount === 'number' && data.amount > 0 ? data.amount : PREPAID_TOPUP_CENTS;
      const orderId = data.id ?? `anon:${teamId}:${String(cents)}`;
      await creditWalletFromPolarOrder({
        db: input.db,
        teamId,
        orderId,
        cents,
      });
    }
  }

  if (type === 'order.refunded' || type === 'refund.created' || type === 'refund.updated') {
    const refundStatus = (data?.status ?? 'succeeded').trim().toLowerCase();
    if (type !== 'order.refunded' && refundStatus && refundStatus !== 'succeeded') {
      return { ok: true, ignored: 'refund_not_succeeded' };
    }
    const topupProductId = input.products.topup;
    const isTopupProduct = Boolean(topupProductId && data?.product_id === topupProductId);
    const orderId =
      type === 'order.refunded' ? (data?.id ?? null) : (data?.order_id ?? data?.orderId ?? null);
    const refundId = type === 'order.refunded' ? null : (data?.id ?? null);
    const cents =
      typeof data?.amount === 'number' && data.amount > 0
        ? data.amount
        : typeof data?.refunded_amount === 'number' && data.refunded_amount > 0
          ? data.refunded_amount
          : typeof data?.refundedAmount === 'number' && data.refundedAmount > 0
            ? data.refundedAmount
            : 0;
    if (orderId && (isTopupProduct || type !== 'order.refunded' || cents > 0)) {
      await debitWalletFromPolarRefund({
        db: input.db,
        teamId,
        orderId,
        refundKey: refundId ?? `order:${orderId}`,
        cents,
      });
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

  return { ok: true };
}
