import IORedis, { type Redis } from 'ioredis';

import { getEnv } from '../env.js';

let _conn: Redis | undefined;

/**
 * Singleton Redis connection for BullMQ. `maxRetriesPerRequest: null` is
 * required by BullMQ workers (blocking BRPOPLPUSH calls would otherwise
 * fail under retry). `lazyConnect` keeps test environments from opening a
 * socket on import.
 */
export function getRedisConnection(): Redis {
  if (_conn) return _conn;
  const env = getEnv();
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the job queue');
  _conn = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  return _conn;
}

export async function closeRedisConnection(): Promise<void> {
  if (!_conn) return;
  const c = _conn;
  _conn = undefined;
  await c.quit().catch(() => undefined);
}
