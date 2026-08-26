import { billingUsageLedger, teamMembers, teams, users, type Db } from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { BillingProvider } from '#src/billing/provider.js';

import {
  PREPAID_TOPUP_CENTS,
  formatEuroFromCents,
  planUsesPrepaidWallet,
} from '#src/billing/catalog.js';
import { createPolarBillingProvider, polarTopUpProductId } from '#src/billing/polar.js';
import { childLogger } from '#src/logger.js';
import { sendMessage } from '#src/messaging/delivery.js';

const log = childLogger('billing:auto-reload');
const AUTO_RELOAD_ATTEMPT_STALE_MS = 15 * 60 * 1000;

function appBaseUrl(): string {
  return (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'https://thetimeline.cc').replace(
    /\/+$/u,
    '',
  );
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * When auto-reload is on and available wallet is at/below the threshold, open a
 * Polar top-up checkout (capped by remaining spend-cap headroom) and email
 * owners the URL. Wallet credit still arrives on Polar `order.paid`.
 */
export async function maybeTriggerWalletAutoReload(input: {
  db: Db;
  teamId: string;
  account: {
    autoReloadEnabled: boolean;
    autoReloadThresholdCents: number | null;
    autoReloadAmountCents: number | null;
    walletBalanceCents: number;
    reservedBalanceCents: number;
    spendCapCents: number;
    shadowBilling: boolean;
    polarCustomerId: string | null;
    planId: string;
  };
  meteredSpendCents: number;
  provider?: BillingProvider | null;
}): Promise<{ triggered: boolean; reason?: string }> {
  const account = input.account;
  if (!account.autoReloadEnabled) return { triggered: false, reason: 'disabled' };
  if (account.shadowBilling) return { triggered: false, reason: 'shadow' };
  if (!planUsesPrepaidWallet(account.planId)) return { triggered: false, reason: 'plan' };
  const threshold = account.autoReloadThresholdCents ?? 500;
  const available = account.walletBalanceCents - account.reservedBalanceCents;
  if (available > threshold) return { triggered: false, reason: 'above_threshold' };

  let amount = account.autoReloadAmountCents ?? PREPAID_TOPUP_CENTS;
  if (amount !== PREPAID_TOPUP_CENTS) {
    amount = PREPAID_TOPUP_CENTS;
  }
  const headroom = Math.max(0, account.spendCapCents - input.meteredSpendCents);
  if (headroom < PREPAID_TOPUP_CENTS) return { triggered: false, reason: 'spend_cap' };
  if (amount <= 0) return { triggered: false, reason: 'spend_cap' };

  const productId = polarTopUpProductId();
  if (!productId) return { triggered: false, reason: 'missing_product' };

  const day = utcDay();
  const operationId = `auto_reload:${input.teamId}:${day}`;
  const [ledgerRow] = await input.db
    .insert(billingUsageLedger)
    .values({
      teamId: input.teamId,
      operationId,
      kind: 'top_up',
      meterId: 'ai',
      nativeUnits: '0',
      customerChargeCents: 0,
      billable: false,
      nonBillableReason: 'wallet_auto_reload_checkout',
      operationClass: 'wallet_auto_reload',
      source: 'polar_checkout',
      metadata: {
        amount_cents: amount,
        threshold_cents: threshold,
        auto_reload_status: 'attempting',
        auto_reload_attempted_at: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
    .returning();
  if (!ledgerRow) {
    const [existing] = await input.db
      .select({ metadata: billingUsageLedger.metadata })
      .from(billingUsageLedger)
      .where(
        and(
          eq(billingUsageLedger.teamId, input.teamId),
          eq(billingUsageLedger.operationId, operationId),
        ),
      )
      .limit(1);
    const status = existing?.metadata.auto_reload_status;
    const checkoutUrl = existing?.metadata.checkout_url;
    if (status === 'sent' || typeof checkoutUrl === 'string') {
      return { triggered: false, reason: 'already_triggered_today' };
    }
    if (status === 'attempting') {
      const attemptedAt = existing?.metadata.auto_reload_attempted_at;
      const attemptedMs = typeof attemptedAt === 'string' ? Date.parse(attemptedAt) : Number.NaN;
      if (Number.isFinite(attemptedMs) && Date.now() - attemptedMs < AUTO_RELOAD_ATTEMPT_STALE_MS) {
        return { triggered: false, reason: 'already_triggered_today' };
      }
    }
    await input.db
      .delete(billingUsageLedger)
      .where(
        and(
          eq(billingUsageLedger.teamId, input.teamId),
          eq(billingUsageLedger.operationId, operationId),
        ),
      );
    return maybeTriggerWalletAutoReload(input);
  }

  const abandon = async () => {
    await input.db.delete(billingUsageLedger).where(eq(billingUsageLedger.id, ledgerRow.id));
  };

  const [team] = await input.db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, input.teamId))
    .limit(1);
  const owners = await input.db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
        eq(teamMembers.role, 'owner'),
        isNull(teamMembers.removedAt),
      ),
    );
  const ownerEmail = owners.find((owner) => owner.email)?.email;
  if (!ownerEmail) {
    await abandon();
    return { triggered: false, reason: 'no_owner_email' };
  }

  const provider = input.provider ?? createPolarBillingProvider();
  if (!provider) {
    await abandon();
    return { triggered: false, reason: 'provider_unavailable' };
  }

  const base = appBaseUrl();
  let checkoutUrl = `${base}/app/team?section=billing`;
  try {
    const checkout = await provider.createCheckoutSession({
      externalCustomerId: input.teamId,
      customerEmail: ownerEmail,
      productId,
      successUrl: `${base}/app/team?section=billing&checkout=topup`,
    });
    checkoutUrl = checkout.url;
  } catch (err) {
    log.warn({ err, teamId: input.teamId }, 'auto-reload Polar checkout failed');
    await abandon();
    return { triggered: false, reason: 'checkout_failed' };
  }

  await input.db
    .update(billingUsageLedger)
    .set({
      metadata: sql`${billingUsageLedger.metadata} || ${JSON.stringify({
        auto_reload_status: 'sent',
        checkout_url: checkoutUrl,
      })}::jsonb`,
    })
    .where(eq(billingUsageLedger.id, ledgerRow.id));

  const ym = periodYm();
  const teamName = team?.name ?? 'your workspace';
  for (const owner of owners) {
    if (!owner.email) continue;
    try {
      await sendMessage(
        'billing_usage_alert',
        {
          to: owner.email,
          ownerName: owner.name,
          teamName,
          kind: 'wallet_auto_reload',
          periodYm: ym,
          planName: account.planId,
          detailLine: `Wallet available ${formatEuroFromCents(Math.max(0, available))} is at or below ${formatEuroFromCents(threshold)}. Complete this ${formatEuroFromCents(amount)} Polar top-up to reload.`,
          usageUrl: `${base}/app/usage`,
          billingUrl: checkoutUrl,
        },
        {
          db: input.db,
          teamId: input.teamId,
          userId: owner.userId,
          dedupeKey: `billing-alert|${input.teamId}|${day}|wallet_auto_reload|${owner.userId}`,
          metadata: { billing_alert_kind: 'wallet_auto_reload', checkout_url: checkoutUrl },
        },
      );
    } catch (err) {
      log.warn({ err, teamId: input.teamId }, 'auto-reload email failed');
    }
  }
  return { triggered: true };
}
