import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../drizzle');

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    console.log(`[migrate] applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log('[migrate] complete');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
