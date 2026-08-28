import { billingUsageReservations, teamBillingAccounts, type Db } from '@timeline/db';
import { and, eq, lt, sql } from 'drizzle-orm';

import { walletLockCentsFromMetadata } from '#src/billing/charge.js';

export async function expireStaleBillingReservations(input: {
  db: Db;
  teamId?: string;
}): Promise<number> {
  return input.db.transaction(async (tx) => {
    const expired = await tx
      .update(billingUsageReservations)
      .set({ state: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(billingUsageReservations.state, 'reserved'),
          lt(billingUsageReservations.expiresAt, new Date()),
          sql`coalesce(${billingUsageReservations.metadata}->>'pending_recall_leave_bot_id', '') = ''`,
          ...(input.teamId ? [eq(billingUsageReservations.teamId, input.teamId)] : []),
        ),
      )
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
