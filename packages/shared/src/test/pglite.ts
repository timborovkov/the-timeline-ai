import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

export async function applyDbMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && statement !== 'SELECT 1;');

    for (const statement of statements) {
      await pg.exec(statement);
    }
  }
}

export interface ResettablePGliteTestDb {
  pg: PGlite;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Migrate once, then truncate and reseed data between sequential tests. */
export async function createResettablePGliteTestDb(
  seed?: (pg: PGlite) => Promise<void>,
): Promise<ResettablePGliteTestDb> {
  const pg = new PGlite();
  await applyDbMigrations(pg);
  const tableRows = await pg.query<{ tablename: string }>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  const tableList = tableRows.rows
    .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
    .join(', ');
  return {
    pg,
    reset: async () => {
      if (tableList) await pg.exec(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
      await seed?.(pg);
    },
    close: () => pg.close(),
  };
}
