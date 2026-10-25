import { billingUsageReservations, teamBillingAccounts, type Db } from '@timeline/db';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import { walletLockCentsFromMetadata } from '#src/billing/charge.js';

/**
 * Provider work already succeeded. Settlement recovery must keep this row
 * until the ledger write lands, including after the reservation TTL.
 */
export function reservationKeepsProviderResult(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  return metadata.worker_settlement_pending === true || metadata.provider_completed === true;
}

/**
 * Failed provider usage saved before its ledger insert. Reusing a released
 * reservation must keep this until that attempt's settlement commits.
 */
export function failedAttemptSettlementMetadata(
  metadata: unknown,
): { pending_failed_attempts: unknown[]; pending_failed_attempt_settlement: true } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const attempts = record.pending_failed_attempts;
  if (record.pending_failed_attempt_settlement !== true) return null;
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  return {
    pending_failed_attempts: attempts,
    pending_failed_attempt_settlement: true,
  };
}

export async function expireStaleBillingReservations(input: {
  db: Db;
  teamId?: string;
}): Promise<number> {
  return input.db.transaction(async (tx) => {
    const expirable = and(
      eq(billingUsageReservations.state, 'reserved'),
      lt(billingUsageReservations.expiresAt, new Date()),
      sql`coalesce(${billingUsageReservations.metadata}->>'pending_recall_leave_bot_id', '') = ''`,
      sql`coalesce(${billingUsageReservations.metadata}->>'pending_settlement', '') <> 'true'`,
      sql`coalesce(${billingUsageReservations.metadata}->>'worker_settlement_pending', '') <> 'true'`,
      sql`coalesce(${billingUsageReservations.metadata}->>'provider_completed', '') <> 'true'`,
      sql`coalesce(${billingUsageReservations.metadata}->>'pending_failed_attempt_settlement', '') <> 'true'`,
      ...(input.teamId ? [eq(billingUsageReservations.teamId, input.teamId)] : []),
    );
    // Lock billing accounts before reservation rows. Reserve, settle, and
    // release take the account lock first, so the opposite order deadlocks a
    // TTL expiry against an in-flight release or settle.
    const candidateTeams = await tx
      .selectDistinct({ teamId: billingUsageReservations.teamId })
      .from(billingUsageReservations)
      .where(expirable);
    const teamIds = [...new Set(candidateTeams.map((row) => row.teamId))].sort();
    if (teamIds.length > 0) {
      await tx
        .select({ teamId: teamBillingAccounts.teamId })
        .from(teamBillingAccounts)
        .where(inArray(teamBillingAccounts.teamId, teamIds))
        .orderBy(asc(teamBillingAccounts.teamId))
        .for('update');
    }
    const expired = await tx
      .update(billingUsageReservations)
      .set({ state: 'expired', updatedAt: new Date() })
      .where(expirable)
      .returning();

    const byTeam = new Map<string, number>();
    for (const row of expired) {
      const cents = walletLockCentsFromMetadata(row.metadata);
      if (cents <= 0) continue;
      byTeam.set(row.teamId, (byTeam.get(row.teamId) ?? 0) + cents);
    }
    for (const [teamId, cents] of byTeam) {
      await tx
        .update(teamBillingAccounts)
        .set({
          reservedBalanceCents: sql`GREATEST(0, ${teamBillingAccounts.reservedBalanceCents} - ${cents})`,
          updatedAt: new Date(),
        })
        .where(eq(teamBillingAccounts.teamId, teamId));
    }
    return expired.length;
  });
}
