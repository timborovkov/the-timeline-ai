import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { entities, type Db } from '@timeline/db';
import { MockLanguageModelV3 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it, vi } from 'vitest';

import { resolveMentions } from '#src/extract/resolve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

const TEAM_ID = '11111111-1111-1111-1111-111111111111';

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) await pg.exec(stmt);
  }
}

describe('resolveMentions', () => {
  it('caches unresolved mentions within one fact', async () => {
    const pg = new PGlite();
    await applyMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'agentic', 'Agentic Core');
    `);
    const db = drizzle(pg) as unknown as Db;
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
  });

  it('can resolve existing mentions without mutating aliases', async () => {
    const pg = new PGlite();
    await applyMigrations(pg);
    await pg.exec(`
      INSERT INTO teams (id, slug, name)
      VALUES ('${TEAM_ID}', 'agentic', 'Agentic Core');
    `);
    const db = drizzle(pg) as unknown as Db;
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
  });
});
