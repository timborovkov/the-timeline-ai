/* eslint-disable no-console -- operational CLI output */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { migrateDatabase } from '../packages/db/src/migrate.ts';
import { resetPostgresSchema } from '../packages/db/src/reset.ts';
import {
  assertDestructiveDevWipeAllowed,
  assertResetNodeEnv,
  configuredBuckets,
  deleteAllQdrantCollections,
  emptyBucket,
  enableBucketVersioning,
  ensureBucket,
  flushRedisAll,
  versionedBuckets,
} from '../packages/shared/src/env-reset.ts';
import { getS3Client } from '../packages/shared/src/s3/client.ts';

loadDotEnv(resolve(process.cwd(), '.env'));

async function main(): Promise<void> {
  const nodeEnv = assertResetNodeEnv(process.env.NODE_ENV);
  assertDestructiveDevWipeAllowed(process.env);
  console.log(`[env-reset] NODE_ENV=${nodeEnv}`);
  console.log('[env-reset] destructive dev reset starting; running services may fail transiently');

  if (process.env.REDIS_URL) {
    console.log('[env-reset] redis: FLUSHALL');
    await flushRedisAll(process.env.REDIS_URL);
  } else {
    console.log('[env-reset] redis: skipped (REDIS_URL unset)');
  }

  if (process.env.QDRANT_URL) {
    console.log('[env-reset] qdrant: deleting all collections');
    const deleted = await deleteAllQdrantCollections({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });
    console.log(`[env-reset] qdrant: deleted ${String(deleted.length)} collection(s)`);
  } else {
    console.log('[env-reset] qdrant: skipped (QDRANT_URL unset)');
  }

  const buckets = configuredBuckets(process.env);
  if (buckets.length > 0) {
    const s3 = getS3Client();
    for (const bucket of buckets) {
      console.log(`[env-reset] s3: empty ${bucket}`);
      const deleted = await emptyBucket(s3, bucket);
      console.log(`[env-reset] s3: deleted ${String(deleted)} object(s) from ${bucket}`);
    }
    for (const bucket of buckets) {
      console.log(`[env-reset] s3: ensure ${bucket}`);
      await ensureBucket(s3, bucket);
    }
    for (const bucket of versionedBuckets(process.env)) {
      console.log(`[env-reset] s3: enable versioning ${bucket}`);
      await enableBucketVersioning(s3, bucket);
    }
  } else {
    console.log('[env-reset] s3: skipped (no S3_BUCKET_* vars set)');
  }

  console.log('[env-reset] postgres: drop/recreate public schema');
  await resetPostgresSchema(process.env.DATABASE_URL);

  console.log('[env-reset] postgres: run migrations');
  await migrateDatabase({ withAdvisoryLock: true });

  console.log('[env-reset] complete');
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const body = readFileSync(path, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = parseDotEnvValue(rawValue ?? '');
  }
}

function parseDotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

main().catch((err: unknown) => {
  console.error('[env-reset] failed', err);
  process.exit(1);
});
