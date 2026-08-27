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

type AutoReloadOwner = {
  userId: string;
  email: string | null;
  name: string | null;
};

async function loadTeamOwners(
  db: Db,
  teamId: string,
): Promise<{ teamName: string; owners: AutoReloadOwner[] }> {
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  const owners = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, 'owner'), isNull(teamMembers.removedAt)),
    );
  return { teamName: team?.name ?? 'your workspace', owners };
}

async function stampAutoReloadStatus(input: {
  db: Db;
  ledgerId: string;
  status: 'checkout_created' | 'sent';
  checkoutUrl: string;
}): Promise<void> {
  await input.db
    .update(billingUsageLedger)
    .set({
      metadata: sql`${billingUsageLedger.metadata} || ${JSON.stringify({
        auto_reload_status: input.status,
        checkout_url: input.checkoutUrl,
      })}::jsonb`,
    })
    .where(eq(billingUsageLedger.id, input.ledgerId));
}

async function notifyAutoReloadOwners(input: {
  db: Db;
  teamId: string;
  planId: string;
  teamName: string;
  owners: AutoReloadOwner[];
  checkoutUrl: string;
  availableCents: number;
  thresholdCents: number;
  amountCents: number;
  day: string;
}): Promise<boolean> {
  const base = appBaseUrl();
  const ym = periodYm();
  let notified = false;
  for (const owner of input.owners) {
    if (!owner.email) continue;
    try {
      const result = await sendMessage(
        'billing_usage_alert',
        {
          to: owner.email,
          ownerName: owner.name,
          teamName: input.teamName,
          kind: 'wallet_auto_reload',
          periodYm: ym,
          planName: input.planId,
          detailLine: `Wallet available ${formatEuroFromCents(Math.max(0, input.availableCents))} is at or below ${formatEuroFromCents(input.thresholdCents)}. Complete this ${formatEuroFromCents(input.amountCents)} Polar top-up to reload.`,
          usageUrl: `${base}/app/usage`,
          billingUrl: input.checkoutUrl,
        },
        {
          db: input.db,
          teamId: input.teamId,
          userId: owner.userId,
          dedupeKey: `billing-alert|${input.teamId}|${input.day}|wallet_auto_reload|${owner.userId}`,
          metadata: { billing_alert_kind: 'wallet_auto_reload', checkout_url: input.checkoutUrl },
        },
      );
      if (result.ok) notified = true;
    } catch (err) {
      log.warn({ err, teamId: input.teamId }, 'auto-reload email failed');
    }
  }
  return notified;
}

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
      .select({ id: billingUsageLedger.id, metadata: billingUsageLedger.metadata })
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
    if (status === 'sent') {
      return { triggered: false, reason: 'already_triggered_today' };
    }
    if (typeof checkoutUrl === 'string' && checkoutUrl.length > 0) {
      const { teamName, owners } = await loadTeamOwners(input.db, input.teamId);
      const notified = await notifyAutoReloadOwners({
        db: input.db,
        teamId: input.teamId,
        planId: account.planId,
        teamName,
        owners,
        checkoutUrl,
        availableCents: available,
        thresholdCents: threshold,
        amountCents: amount,
        day,
      });
      if (notified && existing) {
        await stampAutoReloadStatus({
          db: input.db,
          ledgerId: existing.id,
          status: 'sent',
          checkoutUrl,
        });
        return { triggered: true };
      }
      return { triggered: false, reason: 'notify_failed' };
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

  const { teamName, owners } = await loadTeamOwners(input.db, input.teamId);
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

  await stampAutoReloadStatus({
    db: input.db,
    ledgerId: ledgerRow.id,
    status: 'checkout_created',
    checkoutUrl,
  });

  const notified = await notifyAutoReloadOwners({
    db: input.db,
    teamId: input.teamId,
    planId: account.planId,
    teamName,
    owners,
    checkoutUrl,
    availableCents: available,
    thresholdCents: threshold,
    amountCents: amount,
    day,
  });
  if (notified) {
    await stampAutoReloadStatus({
      db: input.db,
      ledgerId: ledgerRow.id,
      status: 'sent',
      checkoutUrl,
    });
  }
  return { triggered: true };
}
