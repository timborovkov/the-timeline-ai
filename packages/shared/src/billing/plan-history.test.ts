import { PGlite } from '@electric-sql/pglite';
import { billingPlanHistory, billingUsageLedger, teamBillingAccounts, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import {
  backfillFreePlanBaselines,
  billingPlanIdOnDay,
  includedDiscountRemainingForReplay,
  recordBillingPlan,
  settlementMatchesDiscountPeriod,
} from '#src/billing/plan-history.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('settlement discount period', () => {
  const octoberWrite = new Date('2026-10-15T12:00:00.000Z');

  it('counts a September tag in September only when the row was written in October', () => {
    const metadata = {
      pricing_period_ym: '2026-09',
      polar_ingest_period_ym: '2026-10',
      discount_cents: 100,
    };
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-09',
        occurredAt: octoberWrite,
        metadata,
      }),
    ).toBe(true);
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-10',
        occurredAt: octoberWrite,
        metadata,
      }),
    ).toBe(false);
  });

  it('uses the ingest tag when pricing_period_ym is absent', () => {
    const metadata = { polar_ingest_period_ym: '2026-09' };
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-09',
        occurredAt: octoberWrite,
        metadata,
      }),
    ).toBe(true);
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-10',
        occurredAt: octoberWrite,
        metadata,
      }),
    ).toBe(false);
  });

  it('falls back to occurredAt only when neither period tag is set', () => {
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-10',
        occurredAt: octoberWrite,
        metadata: {},
      }),
    ).toBe(true);
    expect(
      settlementMatchesDiscountPeriod({
        periodYm: '2026-09',
        occurredAt: octoberWrite,
        metadata: {},
      }),
    ).toBe(false);
  });
});

describe('included discount remaining for replay', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'discount-replay', 'Discount Replay');
    `);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    await pg.close();
  });

  it('does not spend a tagged backfill against the month the ledger row was written', async () => {
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'storage_gb:backfill:2026-09',
      kind: 'settlement',
      meterId: 'storage_gb_month',
      nativeUnits: '1',
      customerChargeCents: 25,
      metadata: {
        discount_cents: 100,
        pricing_period_ym: '2026-09',
        polar_ingest_period_ym: '2026-10',
      },
      occurredAt: new Date('2026-10-15T12:00:00.000Z'),
    });
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'ai:october',
      kind: 'settlement',
      meterId: 'ai',
      nativeUnits: '50',
      customerChargeCents: 50,
      metadata: { discount_cents: 50 },
      occurredAt: new Date('2026-10-02T12:00:00.000Z'),
    });

    await expect(
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date('2026-09-15T12:00:00.000Z'),
        periodStartedAt: null,
        periodEndsAt: null,
      }),
    ).resolves.toBe(5_900);
    await expect(
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date('2026-10-15T12:00:00.000Z'),
        periodStartedAt: null,
        periodEndsAt: null,
      }),
    ).resolves.toBe(5_950);
  });

  it('shares one renewal window across the calendar months it spans', async () => {
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: `storage_gb:${TEAM_ID}:2026-09-20`,
      kind: 'settlement',
      meterId: 'storage_gb_month',
      nativeUnits: '1',
      customerChargeCents: 25,
      metadata: {
        discount_cents: 100,
        pricing_period_ym: '2026-09',
        usage_at: '2026-09-20T12:00:00.000Z',
      },
      occurredAt: new Date('2026-10-15T12:00:00.000Z'),
    });
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: `storage_gb:${TEAM_ID}:2026-10-02`,
      kind: 'settlement',
      meterId: 'storage_gb_month',
      nativeUnits: '1',
      customerChargeCents: 25,
      metadata: { discount_cents: 50, pricing_period_ym: '2026-10' },
      occurredAt: new Date('2026-10-16T12:00:00.000Z'),
    });
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: `storage_gb:${TEAM_ID}:2026-10-20`,
      kind: 'settlement',
      meterId: 'storage_gb_month',
      nativeUnits: '1',
      customerChargeCents: 25,
      metadata: { discount_cents: 25, pricing_period_ym: '2026-10' },
      occurredAt: new Date('2026-10-20T12:00:00.000Z'),
    });
    const bounds = {
      periodStartedAt: new Date('2026-09-15T00:00:00.000Z'),
      periodEndsAt: new Date('2026-10-15T00:00:00.000Z'),
    };
    await expect(
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date('2026-09-20T12:00:00.000Z'),
        ...bounds,
      }),
    ).resolves.toBe(5_850);
    await expect(
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date('2026-10-20T12:00:00.000Z'),
        ...bounds,
      }),
    ).resolves.toBe(5_975);
  });

  it('counts an untagged September usage instant in September when the row was written in October', async () => {
    const octoberWrite = new Date('2026-10-15T12:00:00.000Z');
    await db.insert(billingUsageLedger).values([
      {
        teamId: TEAM_ID,
        operationId: 'ai:september-recovered',
        kind: 'settlement',
        meterId: 'ai',
        nativeUnits: '100',
        customerChargeCents: 0,
        metadata: {
          discount_cents: 100,
          usage_at: '2026-09-20T12:00:00.000Z',
        },
        occurredAt: octoberWrite,
      },
      {
        teamId: TEAM_ID,
        operationId: 'ai:tagged-october',
        kind: 'settlement',
        meterId: 'ai',
        nativeUnits: '50',
        customerChargeCents: 50,
        metadata: {
          discount_cents: 50,
          usage_at: '2026-09-21T12:00:00.000Z',
          pricing_period_ym: '2026-10',
        },
        occurredAt: octoberWrite,
      },
      {
        teamId: TEAM_ID,
        operationId: 'ai:recovered:2026-09-12',
        kind: 'settlement',
        meterId: 'ai',
        nativeUnits: '25',
        customerChargeCents: 25,
        metadata: { discount_cents: 25 },
        occurredAt: octoberWrite,
      },
    ]);
    const monthBoundary = {
      periodStartedAt: new Date('2026-09-01T00:00:00.000Z'),
      periodEndsAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const remaining = (usageAt: string, bounds: typeof monthBoundary | null) =>
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date(usageAt),
        periodStartedAt: bounds?.periodStartedAt ?? null,
        periodEndsAt: bounds?.periodEndsAt ?? null,
      });

    await expect(remaining('2026-09-15T12:00:00.000Z', monthBoundary)).resolves.toBe(5_875);
    await expect(remaining('2026-10-15T12:00:00.000Z', monthBoundary)).resolves.toBe(5_950);
    await expect(remaining('2026-09-15T12:00:00.000Z', null)).resolves.toBe(5_875);
    await expect(remaining('2026-10-15T12:00:00.000Z', null)).resolves.toBe(5_950);
  });

  it('keeps a stamped live settlement in the renewal window that contains usage_at', async () => {
    const renewal = {
      periodStartedAt: new Date('2026-10-10T00:00:00.000Z'),
      periodEndsAt: new Date('2026-11-10T00:00:00.000Z'),
    };
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'ai:live-before-renewal',
      kind: 'settlement',
      meterId: 'ai',
      nativeUnits: '40',
      customerChargeCents: 40,
      metadata: {
        discount_cents: 100,
        polar_ingest_period_ym: '2026-10',
        usage_at: '2026-10-05T08:15:00.000Z',
      },
      occurredAt: new Date('2026-10-25T13:00:00.000Z'),
    });
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'ai:untimed-october',
      kind: 'settlement',
      meterId: 'ai',
      nativeUnits: '20',
      customerChargeCents: 20,
      metadata: {
        discount_cents: 50,
        polar_ingest_period_ym: '2026-10',
      },
      occurredAt: new Date('2026-10-25T13:00:00.000Z'),
    });

    const remaining = (usageAt: string) =>
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date(usageAt),
        ...renewal,
      });

    await expect(remaining('2026-10-05T08:15:00.000Z')).resolves.toBe(5_900);
    await expect(remaining('2026-10-20T12:00:00.000Z')).resolves.toBe(5_950);
  });

  it('attributes a straddling Recall discount to the window that spent it', async () => {
    await db.insert(billingUsageLedger).values({
      teamId: TEAM_ID,
      operationId: 'recall:across-renewal',
      kind: 'settlement',
      meterId: 'recall_minutes',
      nativeUnits: '2',
      customerChargeCents: 6,
      metadata: {
        discount_cents: 6,
        usage_at: '2026-09-30T23:59:00.000Z',
        discount_windows: [
          {
            started_at: '2026-09-01T00:00:00.000Z',
            ends_at: '2026-10-01T00:00:00.000Z',
            discount_cents: 3,
            native_units: 1,
          },
          {
            started_at: '2026-10-01T00:00:00.000Z',
            ends_at: '2026-11-01T00:00:00.000Z',
            discount_cents: 3,
            native_units: 1,
          },
        ],
      },
      occurredAt: new Date('2026-10-01T00:01:00.000Z'),
    });
    const bounds = {
      periodStartedAt: new Date('2026-10-01T00:00:00.000Z'),
      periodEndsAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    const remaining = (usageAt: string) =>
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        usageAt: new Date(usageAt),
        ...bounds,
      });
    await expect(remaining('2026-09-30T23:59:00.000Z')).resolves.toBe(5_997);
    await expect(remaining('2026-10-15T12:00:00.000Z')).resolves.toBe(5_997);
  });
});

describe('free plan baseline', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'plan-baseline', 'Plan Baseline');
    `);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    await pg.close();
  });

  async function planOn(day: string) {
    return billingPlanIdOnDay({
      db,
      teamId: TEAM_ID,
      day,
      account: { planId: 'team' },
    });
  }

  it('keeps days before the first upgrade on the outgoing Free plan', async () => {
    await db.insert(teamBillingAccounts).values({
      teamId: TEAM_ID,
      planId: 'team',
      billingState: 'team_active',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await recordBillingPlan(db, TEAM_ID, 'team', new Date('2026-09-01T00:00:00.000Z'), {
      planId: 'free',
      effectiveAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await expect(planOn('2026-08-15')).resolves.toBe('free');
    await expect(planOn('2026-09-02')).resolves.toBe('team');
  });

  it('backfills a Free row before an existing paid history row', async () => {
    await db.insert(teamBillingAccounts).values({
      teamId: TEAM_ID,
      planId: 'team',
      billingState: 'team_active',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await db.insert(billingPlanHistory).values({
      teamId: TEAM_ID,
      planId: 'team',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await expect(planOn('2026-08-15')).resolves.toBe('team');
    await expect(backfillFreePlanBaselines(db)).resolves.toBe(1);
    await expect(backfillFreePlanBaselines(db)).resolves.toBe(0);
    await expect(planOn('2026-08-15')).resolves.toBe('free');
    await expect(planOn('2026-09-02')).resolves.toBe('team');
    const rows = await db
      .select({ planId: billingPlanHistory.planId })
      .from(billingPlanHistory)
      .where(eq(billingPlanHistory.teamId, TEAM_ID))
      .orderBy(asc(billingPlanHistory.effectiveAt));
    expect(rows.map((row) => row.planId)).toEqual(['free', 'team']);
  });
});
