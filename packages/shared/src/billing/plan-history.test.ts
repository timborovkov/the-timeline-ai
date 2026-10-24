import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  includedDiscountRemainingForReplay,
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
        periodYm: '2026-09',
      }),
    ).resolves.toBe(5_900);
    await expect(
      includedDiscountRemainingForReplay({
        db,
        teamId: TEAM_ID,
        planId: 'team',
        periodYm: '2026-10',
      }),
    ).resolves.toBe(5_950);
  });
});
