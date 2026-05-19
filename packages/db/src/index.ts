import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';

export * from './schema/index';
export { schema };
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

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = undefined;
    _db = undefined;
  }
}
