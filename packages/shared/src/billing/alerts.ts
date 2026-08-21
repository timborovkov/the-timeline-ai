import { type Db, teamMembers, teams, users } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { BillingUsageAlertKind } from '#src/messaging/types.js';

import {
  FREE_ALLOWANCES,
  PLAN_CATALOG,
  formatEuroFromCents,
  type BillingPlanId,
} from '#src/billing/catalog.js';
import {
  freeAllowanceRemaining,
  spendCapUtilization,
  type FreeAllowanceRemaining,
} from '#src/billing/status.js';
import { childLogger } from '#src/logger.js';
import { sendMessage } from '#src/messaging/delivery.js';

const log = childLogger('billing:alerts');

function appBaseUrl(): string {
  return (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? 'https://thetimeline.cc').replace(
    /\/+$/u,
    '',
  );
}

function periodYm(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function freeNearLimit(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= FREE_ALLOWANCES.aiChargeCents * 0.25 ||
    remaining.recallMinutes <= FREE_ALLOWANCES.recallMinutes * 0.25 ||
    remaining.emailUnits <= FREE_ALLOWANCES.emailUnits * 0.25 ||
    remaining.storageGb <= FREE_ALLOWANCES.storageGb * 0.25 ||
    remaining.acceptedSources <= FREE_ALLOWANCES.acceptedSources * 0.25
  );
}

function freeExhausted(remaining: FreeAllowanceRemaining): boolean {
  return (
    remaining.aiChargeCents <= 0 ||
    remaining.recallMinutes <= 0 ||
    remaining.emailUnits <= 0 ||
    remaining.storageGb <= 0 ||
    remaining.acceptedSources <= 0
  );
}

/** Pure threshold selection for tests and settle-time alerts. */
export function billingUsageAlertKindsForState(input: {
  planId: BillingPlanId;
  spendCapCents: number;
  meteredSpendCents: number;
  freeRemaining: FreeAllowanceRemaining;
}): BillingUsageAlertKind[] {
  const kinds: BillingUsageAlertKind[] = [];
  if (input.planId === 'free') {
    if (freeExhausted(input.freeRemaining)) {
      kinds.push('free_exhausted');
      return kinds;
    }
    if (freeNearLimit(input.freeRemaining)) kinds.push('free_near_limit');
    return kinds;
  }

  const utilization = spendCapUtilization(input.meteredSpendCents, input.spendCapCents);
  if (utilization.warnLevel === null) return kinds;
  if (utilization.warnLevel >= 50) kinds.push('spend_cap_50');
  if (utilization.warnLevel >= 75) kinds.push('spend_cap_75');
  if (utilization.warnLevel >= 90) kinds.push('spend_cap_90');
  if (utilization.warnLevel >= 100) kinds.push('spend_cap_100');
  return kinds;
}

function detailLineForKind(
  kind: BillingUsageAlertKind,
  input: {
    meteredSpendCents: number;
    spendCapCents: number;
    freeRemaining: FreeAllowanceRemaining;
  },
): string {
  switch (kind) {
    case 'spend_cap_50':
    case 'spend_cap_75':
    case 'spend_cap_90':
    case 'spend_cap_100':
      return `Metered this period: ${formatEuroFromCents(input.meteredSpendCents)} of ${formatEuroFromCents(input.spendCapCents)}.`;
    case 'free_near_limit':
    case 'free_exhausted':
      return `Remaining Free floor — AI ${formatEuroFromCents(input.freeRemaining.aiChargeCents)}, meetings ${String(input.freeRemaining.recallMinutes)} min, email ${String(input.freeRemaining.emailUnits)}, storage ${String(input.freeRemaining.storageGb)} GB, sources ${String(input.freeRemaining.acceptedSources)}.`;
  }
}

/**
 * After usage settlement, email workspace owners once per threshold/period.
 * Best-effort: failures are logged and never fail the settle path.
 */
export async function notifyBillingUsageAlerts(input: {
  db: Db;
  teamId: string;
  planId: BillingPlanId;
  spendCapCents: number;
  meteredSpendCents: number;
  meters: Partial<Record<string, { nativeUnits: number; customerChargeCents: number } | undefined>>;
}): Promise<{ sent: number; skipped: number }> {
  const freeRemaining = freeAllowanceRemaining({
    ai: input.meters.ai ?? null,
    recall_minutes: input.meters.recall_minutes ?? null,
    email_units: input.meters.email_units ?? null,
    storage_gb_month: input.meters.storage_gb_month ?? null,
    accepted_sources: input.meters.accepted_sources ?? null,
  });
  const kinds = billingUsageAlertKindsForState({
    planId: input.planId,
    spendCapCents: input.spendCapCents,
    meteredSpendCents: input.meteredSpendCents,
    freeRemaining,
  });
  if (kinds.length === 0) return { sent: 0, skipped: 0 };

  const [team] = await input.db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, input.teamId))
    .limit(1);
  const teamName = team?.name ?? 'your workspace';
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

  const base = appBaseUrl();
  const usageUrl = `${base}/app/usage`;
  const billingUrl = `${base}/app/team?section=billing`;
  const ym = periodYm();
  const planName = PLAN_CATALOG[input.planId].name;
  let sent = 0;
  let skipped = 0;

  for (const kind of kinds) {
    const detailLine = detailLineForKind(kind, {
      meteredSpendCents: input.meteredSpendCents,
      spendCapCents: input.spendCapCents,
      freeRemaining,
    });
    for (const owner of owners) {
      if (!owner.email) {
        skipped += 1;
        continue;
      }
      const dedupeKey = `billing-alert|${input.teamId}|${ym}|${kind}|${owner.userId}`;
      try {
        const result = await sendMessage(
          'billing_usage_alert',
          {
            to: owner.email,
            ownerName: owner.name,
            teamName,
            kind,
            periodYm: ym,
            planName,
            detailLine,
            usageUrl,
            billingUrl,
          },
          {
            db: input.db,
            teamId: input.teamId,
            userId: owner.userId,
            dedupeKey,
            metadata: { billing_alert_kind: kind, period_ym: ym },
          },
        );
        if (result.skipped) skipped += 1;
        else if (result.ok) sent += 1;
        else {
          skipped += 1;
          log.warn(
            { teamId: input.teamId, kind, err: result.error },
            'billing usage alert send failed',
          );
        }
      } catch (err) {
        skipped += 1;
        log.warn({ err, teamId: input.teamId, kind }, 'billing usage alert threw');
      }
    }
  }

  return { sent, skipped };
}
