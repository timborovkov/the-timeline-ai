import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, billingUsageReservations, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { MockEmbeddingModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { reserveAskAi } from '#src/billing/admission.js';
import { runWorkerBilling } from '#src/billing/runtime.js';
import { createBillingScope } from '#src/billing/scope.js';
import { resetEnvForTests } from '#src/env.js';
import { embed, embedMany } from '#src/llm/embed.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { applyDbMigrations } from '#src/test/pglite.js';

import type { EmbeddingModel } from 'ai';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

function vector(marker: number): number[] {
  return Array.from({ length: TIMELINE_MODELS.embedding.embeddingDimensions }, (_, index) =>
    index === 0 ? marker : 0,
  );
}

function modelForTexts(): { model: EmbeddingModel; calls: string[][] } {
  const calls: string[][] = [];
  const markers: Record<string, number> = { alpha: 1, beta: 2, gamma: 3 };
  const model = new MockEmbeddingModelV3({
    doEmbed: (({ values }: { values: string[] }) => {
      calls.push(values);
      return Promise.resolve({
        embeddings: values.map((value) => vector(markers[value] ?? 0)),
      });
    }) as never,
  });
  return { model, calls };
}

describe('embedding billing operation ids', () => {
  let pg: PGlite;
  let db: Db;

  beforeEach(async () => {
    pg = new PGlite();
    await applyDbMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'embed-billing', 'Embed Billing');
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'owner@example.test');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
    `);
    db = drizzle(pg) as unknown as Db;
  });

  afterEach(async () => {
    resetEnvForTests();
    await pg.close();
  });

  // Search must remain affordable while Ask holds its own one-euro reservation.
  it('admits a search embedding with 99.4 cents used and an active Ask reservation', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.settle({
      operationId: 'prior-usage',
      meterId: 'ai',
      nativeUnits: 99.4,
      customerChargeCents: 99,
    });
    expect(
      (
        await reserveAskAi(billing, {
          operationId: 'ask:web:search',
          deliverySurface: 'web',
        })
      ).ok,
    ).toBe(true);
    const { model, calls } = modelForTexts();
    const result = await runWorkerBilling(db, TEAM_ID, 'embedding', () =>
      embed({ text: 'alpha' }, { model }),
    );
    expect(result.vector[0]).toBe(1);
    expect(calls).toEqual([['alpha']]);
  });

  it('admits a small embedding batch alongside Ask and charges reported provider cost', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.settle({
      operationId: 'prior-usage',
      meterId: 'ai',
      nativeUnits: 99.4,
      customerChargeCents: 99,
    });
    await reserveAskAi(billing, { operationId: 'ask:web:batch', deliverySurface: 'web' });
    const model = new MockEmbeddingModelV3({
      doEmbed: (({ values }: { values: string[] }) =>
        Promise.resolve({
          embeddings: values.map(() => vector(1)),
          response: { body: { usage: { cost: values.length * 0.00001 } } },
        })) as never,
    });
    for (let search = 0; search < 2; search += 1) {
      await runWorkerBilling(db, TEAM_ID, 'embedding', () =>
        embedMany({ texts: ['alpha', 'beta'] }, { model }),
      );
    }
    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(ledger.filter((row) => row.operationClass === 'embedding')).toHaveLength(2);
    const embedding = ledger.find((row) => row.operationClass === 'embedding');
    expect(embedding?.metadata.openrouter_usd).toBe(0.00002);
    expect(Number(embedding?.nativeUnits)).toBeGreaterThan(0);
    expect(Number(embedding?.nativeUnits)).toBeLessThan(1);
  });

  for (const scenario of [
    { name: 'exhausted allowance', used: 200, texts: ['alpha'] },
    { name: 'insufficient sub-cent allowance', used: 199.999999, texts: ['alpha'] },
    {
      name: 'batch exceeding the remaining budget',
      used: 199,
      texts: Array.from({ length: 10 }, () => 'word '.repeat(6000)),
    },
  ]) {
    it(`rejects embeddings before provider execution for ${scenario.name}`, async () => {
      const billing = createBillingScope({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        ensureMember: () => Promise.resolve('owner'),
      });
      await billing.settle({
        operationId: 'prior-usage',
        meterId: 'ai',
        nativeUnits: scenario.used,
        customerChargeCents: Math.floor(scenario.used),
      });
      const { model, calls } = modelForTexts();
      await expect(
        runWorkerBilling(db, TEAM_ID, 'embedding', () =>
          embedMany({ texts: scenario.texts }, { model }),
        ),
      ).rejects.toMatchObject({ code: 'free_allowance_reached' });
      expect(calls).toEqual([]);
    });
  }

  it('budgets truncated inputs and includes every allowed retry', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.settle({
      operationId: 'prior-usage',
      meterId: 'ai',
      nativeUnits: 199.4,
      customerChargeCents: 199,
    });
    const { model, calls } = modelForTexts();
    const text = 'word '.repeat(100_000);
    await expect(
      runWorkerBilling(db, TEAM_ID, 'embedding', () => embed({ text }, { model, maxRetries: 2 })),
    ).rejects.toMatchObject({ code: 'free_allowance_reached' });
    expect(calls).toEqual([]);
    // Truncation makes one attempt fit; budgeting the original text would reject it.
    await expect(
      runWorkerBilling(db, TEAM_ID, 'embedding', () => embed({ text }, { model, maxRetries: 0 })),
    ).resolves.toMatchObject({ model: TIMELINE_MODELS.embedding.id });
    expect(calls).toHaveLength(1);
  });

  it('does not round a fractional embedding budget up against the Free allowance', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    await billing.settle({
      operationId: 'prior-usage',
      meterId: 'ai',
      nativeUnits: 199.2,
      customerChargeCents: 199,
    });
    const { model } = modelForTexts();
    await expect(
      runWorkerBilling(db, TEAM_ID, 'embedding', () =>
        embed({ text: 'word '.repeat(6000) }, { model }),
      ),
    ).resolves.toMatchObject({ model: TIMELINE_MODELS.embedding.id });
  });

  for (const { plan, discount } of [
    { plan: 'team', discount: 0 },
    { plan: 'payg', discount: 0 },
    { plan: 'team', discount: 80 },
    { plan: 'payg', discount: 80 },
    { plan: 'team', discount: 99 },
  ]) {
    it(`keeps fractional embedding holds behind the ${plan} paid spend cap with ${discount}% discount`, async () => {
      const billing = createBillingScope({
        db,
        teamId: TEAM_ID,
        userId: USER_ID,
        ensureMember: () => Promise.resolve('owner'),
      });
      await billing.settle({
        operationId: 'prior-usage',
        meterId: 'ai',
        nativeUnits: 200,
        customerChargeCents: 200,
      });
      process.env.BILLING_CHARGES_ENABLED = 'true';
      resetEnvForTests();
      try {
        await pg.exec(
          `UPDATE team_billing_accounts SET plan_id = '${plan}', billing_state = '${plan}_active', shadow_billing = false, spend_cap_cents = 0, included_discount_remaining_cents = 0, price_override = '{"meteredDiscountPercent":${discount}}'::jsonb WHERE team_id = '${TEAM_ID}'`,
        );
        const { model, calls } = modelForTexts();
        await expect(
          runWorkerBilling(db, TEAM_ID, 'embedding', () => embed({ text: 'alpha' }, { model })),
        ).rejects.toMatchObject({ code: 'spend_cap_reached' });
        expect(calls).toEqual([]);
        // Exact integer budgets must also retain a positive discounted hold.
        expect(
          await billing.reserve({
            operationId: 'integer-budget',
            meterId: 'ai',
            reservedNativeUnits: 23,
            reservedChargeCents: 23,
          }),
        ).toMatchObject({ ok: false, code: 'spend_cap_reached' });
        await pg.exec(
          `UPDATE team_billing_accounts SET spend_cap_cents = 100 WHERE team_id = '${TEAM_ID}'`,
        );
        await expect(
          runWorkerBilling(db, TEAM_ID, 'embedding', () => embed({ text: 'alpha' }, { model })),
        ).resolves.toMatchObject({ model: TIMELINE_MODELS.embedding.id });
      } finally {
        delete process.env.BILLING_CHARGES_ENABLED;
        resetEnvForTests();
      }
    });
  }

  it('bills each embedding sub-batch separately under one worker operation id', async () => {
    const { model, calls } = modelForTexts();
    const embedBatch = (texts: string[]) =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () => embedMany({ texts }, { model, maxRetries: 0 }),
        {
          operationId: 'embedding:job-split',
        },
      );

    const first = await embedBatch(['alpha', 'beta']);
    const second = await embedBatch(['gamma']);
    const replay = await embedBatch(['alpha', 'beta']);

    expect(calls.flat()).toEqual(['alpha', 'beta', 'gamma']);
    expect(first.vectors.map((item) => item[0])).toEqual([1, 2]);
    expect(second.vectors.map((item) => item[0])).toEqual([3]);
    expect(replay.vectors).toEqual(first.vectors);

    const operationIds = (
      await db
        .select({ operationId: billingUsageLedger.operationId })
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.teamId, TEAM_ID))
    ).map((row) => row.operationId);
    expect(operationIds).toHaveLength(2);
    expect(
      operationIds.every((operationId) =>
        operationId.startsWith('embedding:job-split:embed_many:'),
      ),
    ).toBe(true);
    expect(new Set(operationIds).size).toBe(2);
  });

  it('settles provider cost when a batch vector fails validation and bills the retry', async () => {
    let calls = 0;
    const model = new MockEmbeddingModelV3({
      doEmbed: (() => {
        calls += 1;
        return Promise.resolve({
          embeddings: [[1, 2, 3, 4]],
          usage: { tokens: 4 },
          warnings: [],
          response: { body: { usage: { cost: calls === 1 ? 0.02 : 0.03 } } },
        });
      }) as never,
    });
    const embedBatch = () =>
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () => embedMany({ texts: ['alpha'] }, { model, maxRetries: 0 }),
        { operationId: 'embedding:invalid-vector' },
      );

    await expect(embedBatch()).rejects.toMatchObject({
      name: 'TimelineAiError',
      operation: 'llm.embedMany',
      causeMessage: 'Embedding provider returned vector 0 with 4 dimensions; expected 1536',
    });
    await expect(embedBatch()).rejects.toMatchObject({
      name: 'TimelineAiError',
      operation: 'llm.embedMany',
      causeMessage: 'Embedding provider returned vector 0 with 4 dimensions; expected 1536',
    });

    expect(calls).toBe(2);
    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const attempts = ledger.filter((row) => row.operationId.includes(':failed:'));
    expect(attempts).toHaveLength(2);
    expect(attempts.map((row) => row.metadata.openrouter_usd)).toEqual(
      expect.arrayContaining([0.02, 0.03]),
    );
    const reservations = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.teamId, TEAM_ID));
    expect(reservations.every((row) => row.state === 'released')).toBe(true);
  });

  it('settles provider cost when the embedding count is rejected before the result returns', async () => {
    const model = new MockEmbeddingModelV3({
      doEmbed: (() =>
        Promise.resolve({
          embeddings: [],
          usage: { tokens: 4 },
          warnings: [],
          response: { body: { usage: { cost: 0.05 } } },
        })) as never,
    });

    await expect(
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () => embedMany({ texts: ['alpha'] }, { model, maxRetries: 0 }),
        { operationId: 'embedding:invalid-count' },
      ),
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      operation: 'llm.embedMany',
    });

    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const attempt = ledger.find((row) => row.operationId.includes(':failed:'));
    expect(attempt?.metadata).toMatchObject({ openrouter_usd: 0.05 });
    const [reservation] = await db
      .select()
      .from(billingUsageReservations)
      .where(eq(billingUsageReservations.teamId, TEAM_ID));
    expect(reservation?.state).toBe('released');
  });

  it('settles provider cost when a batch vector contains a non-finite value', async () => {
    const vector = Array.from({ length: TIMELINE_MODELS.embedding.embeddingDimensions }, () => 0);
    vector[3] = Number.NaN;
    const model = new MockEmbeddingModelV3({
      doEmbed: (() =>
        Promise.resolve({
          embeddings: [vector],
          usage: { tokens: 4 },
          warnings: [],
          response: { body: { usage: { cost: 0.04 } } },
        })) as never,
    });

    await expect(
      runWorkerBilling(
        db,
        TEAM_ID,
        'embedding',
        () => embedMany({ texts: ['alpha'] }, { model, maxRetries: 0 }),
        { operationId: 'embedding:non-finite' },
      ),
    ).rejects.toMatchObject({
      name: 'TimelineAiError',
      operation: 'llm.embedMany',
      causeMessage: 'Embedding provider returned non-finite value at vector 0, dimension 3',
    });

    const ledger = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    const attempt = ledger.find((row) => row.operationId.includes(':failed:'));
    expect(attempt?.metadata).toMatchObject({ openrouter_usd: 0.04 });
  });
});
