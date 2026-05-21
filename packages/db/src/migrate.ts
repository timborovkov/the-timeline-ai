/* eslint-disable no-console -- operational status output for the Railway preDeployCommand */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const silenceNotices = (): void => undefined;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../drizzle');

  const client = postgres(url, { max: 1, onnotice: silenceNotices });
  try {
    console.log(`[migrate] applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log('[migrate] complete');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
