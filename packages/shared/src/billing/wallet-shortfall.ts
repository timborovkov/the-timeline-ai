import { billingUsageLedger, type Db } from '@timeline/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Unpaid settlement or refund shortfall still recorded on a ledger row. */
export function outstandingWalletShortfallCents(metadata: Record<string, unknown>): number {
  const shortfall = metadata.wallet_shortfall_cents;
  const collected = metadata.wallet_shortfall_collected_cents;
  const owed = typeof shortfall === 'number' && Number.isFinite(shortfall) ? shortfall : 0;
  const paid = typeof collected === 'number' && Number.isFinite(collected) ? collected : 0;
  return Math.max(0, Math.trunc(owed) - Math.trunc(paid));
}

export async function teamOutstandingWalletShortfallCents(
  dbOrTx: { select: Db['select'] },
  teamId: string,
): Promise<number> {
  const rows = await dbOrTx
    .select({ metadata: billingUsageLedger.metadata })
    .from(billingUsageLedger)
    .where(
      and(
        eq(billingUsageLedger.teamId, teamId),
        inArray(billingUsageLedger.kind, ['settlement', 'reversal']),
      ),
    );
  return rows.reduce((sum, row) => sum + outstandingWalletShortfallCents(row.metadata), 0);
}
