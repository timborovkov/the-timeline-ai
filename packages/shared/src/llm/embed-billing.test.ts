import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, type Db } from '@timeline/db';
import { MockEmbeddingModelV3 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddingModel } from 'ai';

import { runWorkerBilling } from '#src/billing/runtime.js';
import { resetEnvForTests } from '#src/env.js';
import { embedMany } from '#src/llm/embed.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { applyDbMigrations } from '#src/test/pglite.js';

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
      operationIds.every((operationId) => operationId.startsWith('embedding:job-split:input:')),
    ).toBe(true);
    expect(new Set(operationIds).size).toBe(2);
  });
});
