import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export * from './schema/index.js';
export { schema };
export { migrateDatabase } from './migrate.js';
export { resetPostgresSchema } from './reset.js';
export { waitForMigrations } from './wait-for-migrations.js';
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

type Schema = typeof schema;
export type Db = ReturnType<typeof drizzle<Schema>>;

let _db: Db | undefined;
let _client: ReturnType<typeof postgres> | undefined;

export function getDb(): Db {
  if (_db) return _db;
  // Fall back to a placeholder URL when missing so module import at build
  // time does not throw. postgres-js does not connect until first query, so
  // misconfigured envs still fail loudly at request time.
  let url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[db] DATABASE_URL not set; using placeholder. Queries will fail at request time.',
      );
    }
    url = 'postgres://placeholder@localhost:5432/placeholder';
  }
  _client = postgres(url, { max: 10 });
  _db = drizzle(_client, { schema });
  return _db;
}

/**
 * Raw postgres.js client. Use this when you need pool-level operations
 * the drizzle wrapper doesn't expose — primarily `.reserve()` to pin a
 * single connection across two queries (session-scoped advisory locks
 * are the canonical case: `pg_try_advisory_lock` on connection A and
 * `pg_advisory_unlock` on connection B is a no-op, so the lock leaks
 * until A is recycled).
 */
export function getDbClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  // Side-effect: forces _client init via the drizzle path so we use the
  // same pool as the rest of the app. getDb() always sets _client.
  getDb();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return _client!;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = undefined;
    _db = undefined;
  }
}
