import { PGlite } from '@electric-sql/pglite';
import { entities, type Db } from '@timeline/db';
import { MockLanguageModelV3 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it, vi } from 'vitest';

import { resolveMentions } from '#src/extract/resolve.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-1111-1111-111111111111';

async function createTestDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'agentic', 'Agentic Core');
  `);
  return { pg, db: drizzle(pg) as unknown as Db };
}

describe('resolveMentions', () => {
  it('does not create canonical objects for unmatched mentions by default', async () => {
    const { pg, db } = await createTestDb();
    try {
      await expect(
        resolveMentions(
          db,
          TEAM_ID,
          [{ name: 'Newco', type: 'company', role: 'subject' }],
          'Newco was mentioned.',
        ),
      ).resolves.toEqual([null]);

      await expect(db.select().from(entities)).resolves.toEqual([]);
    } finally {
      await pg.close();
    }
  }, 60_000);

  it('requires explicit opt-in to create canonical objects from mentions', async () => {
    const { pg, db } = await createTestDb();
    try {
      const [entityId] = await resolveMentions(
        db,
        TEAM_ID,
        [{ name: 'Newco', type: 'company', role: 'subject' }],
        'Newco was mentioned.',
        {},
        { createIfMissing: true },
      );

      expect(entityId).toBeTypeOf('string');
      await expect(db.select().from(entities)).resolves.toEqual([
        expect.objectContaining({
          id: entityId,
          teamId: TEAM_ID,
          type: 'company',
          canonicalName: 'Newco',
        }),
      ]);
    } finally {
      await pg.close();
    }
  }, 60_000);

  it('caches unresolved mentions within one fact', async () => {
    const { pg, db } = await createTestDb();
    try {
      await db.insert(entities).values([
        {
          teamId: TEAM_ID,
          type: 'company',
          canonicalName: 'Acme Finland',
          aliases: ['Acme'],
        },
        {
          teamId: TEAM_ID,
          type: 'company',
          canonicalName: 'Acme US',
          aliases: ['Acme'],
        },
      ]);
      const doGenerate = vi.fn().mockResolvedValue({
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: 'text', text: '{"choice":-1}' }],
        warnings: [],
      });
      const model = new MockLanguageModelV3({ doGenerate: doGenerate as never });

      await expect(
        resolveMentions(
          db,
          TEAM_ID,
          [
            { name: 'Acme', type: 'company', role: 'subject' },
            { name: 'Acme', type: 'company', role: 'object' },
          ],
          'Acme was mentioned twice.',
          { model },
          { createIfMissing: false },
        ),
      ).resolves.toEqual([null, null]);
      expect(doGenerate).toHaveBeenCalledTimes(1);
    } finally {
      await pg.close();
    }
  }, 60_000);

  it('can resolve existing mentions without mutating aliases', async () => {
    const { pg, db } = await createTestDb();
    try {
      const [inserted] = await db
        .insert(entities)
        .values({
          teamId: TEAM_ID,
          type: 'company',
          canonicalName: 'Acme',
          aliases: ['Acme Inc'],
        })
        .returning({ id: entities.id });
      if (!inserted) throw new Error('expected fixture entity');

      await expect(
        resolveMentions(
          db,
          TEAM_ID,
          [{ name: 'Acme', type: 'company', role: 'subject', aliases: ['ACME CRM'] }],
          'Acme was mentioned with a model-suggested alias.',
          {},
          { createIfMissing: false, updateAliases: false },
        ),
      ).resolves.toEqual([inserted.id]);

      const [row] = await db.select().from(entities).where(eq(entities.id, inserted.id));
      expect(row?.aliases).toEqual(['Acme Inc']);
    } finally {
      await pg.close();
    }
  }, 60_000);

  it('does not resolve mentions to archived objects', async () => {
    const { pg, db } = await createTestDb();
    try {
      await db.insert(entities).values({
        teamId: TEAM_ID,
        type: 'company',
        canonicalName: 'Dormant migration',
        aliases: ['Dormant'],
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(
        resolveMentions(
          db,
          TEAM_ID,
          [{ name: 'Dormant migration', type: 'company', role: 'subject' }],
          'Dormant migration was mentioned.',
          {},
          { createIfMissing: false, updateAliases: false },
        ),
      ).resolves.toEqual([null]);
    } finally {
      await pg.close();
    }
  }, 60_000);
});
