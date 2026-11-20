import { billingUsageLedger, billingUsageReservations, type Db } from '@timeline/db';
import { and, eq, gte, sql } from 'drizzle-orm';

// A price ceiling, not a prediction of the eventual charge. The model's
// 1,048,576 input tokens and 8,000 output tokens fit inside this reservation
// when the gateway enforces these maximum per-token prices.
export const VISION_BUDGET_PRICE_CEILING = {
  prompt: 2,
  completion: 10,
  image: 0,
  request: 0,
} as const;
export const VISION_BUDGET_ESTIMATE_CENTS = 250;
export const VISION_BUDGET_DEFERRED = 'vision_budget_deferred';

export class VisionBudgetDeferredError extends Error {
  constructor() {
    super(VISION_BUDGET_DEFERRED);
    this.name = 'VisionBudgetDeferredError';
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function loadVisionBudgetUsage(db: Db | Tx, teamId: string, now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [spent] = await db
    .select({
      cents: sql<number>`ceil(coalesce(sum(coalesce((${billingUsageLedger.metadata}->>'openrouter_usd')::numeric * 100, ${billingUsageLedger.providerCostCents}, 0)), 0))::int`,
    })
    .from(billingUsageLedger)
    .where(
      and(
        eq(billingUsageLedger.teamId, teamId),
        eq(billingUsageLedger.operationClass, 'vision'),
        gte(billingUsageLedger.occurredAt, start),
      ),
    );
  const [reserved] = await db
    .select({
      cents: sql<number>`coalesce(sum((${billingUsageReservations.metadata}->>'vision_budget_cents')::int), 0)::int`,
    })
    .from(billingUsageReservations)
    .where(
      and(
        eq(billingUsageReservations.teamId, teamId),
        eq(billingUsageReservations.state, 'reserved'),
      ),
    );
  return { spentCents: spent?.cents ?? 0, reservedCents: reserved?.cents ?? 0 };
}
