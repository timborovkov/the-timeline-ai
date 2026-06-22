/* eslint-disable no-console -- operational status output for deploy/startup migrations */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { PG_TIMEOUTS, createPgClient } from '#src/client.js';

const MIGRATION_LOCK_KEY = 911_202_501;

interface MigrateDatabaseOptions {
  url?: string;
  migrationsFolder?: string;
  withAdvisoryLock?: boolean;
}

export async function migrateDatabase(options: MigrateDatabaseOptions = {}): Promise<void> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = options.migrationsFolder ?? resolve(here, '../drizzle');

  const client = createPgClient(url, {
    applicationName: 'timeline-migrator',
    max: 1,
    silenceOperationalNotices: true,
    lockTimeoutMs: PG_TIMEOUTS.migratorLockTimeoutMs,
    statementTimeoutMs: PG_TIMEOUTS.migratorStatementTimeoutMs,
  });
  try {
    if (options.withAdvisoryLock ?? false) {
      await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    }
    console.log(`[migrate] applying migrations from ${migrationsFolder}`);
    await migrate(drizzle(client), { migrationsFolder });
    console.log('[migrate] complete');
  } finally {
    if (options.withAdvisoryLock ?? false) {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => undefined);
    }
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  await migrateDatabase({ withAdvisoryLock: true });
}

const directRunPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (directRunPath === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('[migrate] failed', err);
    process.exit(1);
  });
}
