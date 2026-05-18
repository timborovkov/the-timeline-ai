import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let _db: PostgresJsDatabase | undefined;

export function getDb(): PostgresJsDatabase {
  if (_db) return _db;
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  _db = drizzle(postgres(url));
  return _db;
}

export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
