import { getEnv } from './env.js';
import { childLogger } from './logger.js';
import { getRedisConnection } from './queue/connection.js';

const log = childLogger('cache');

export const APP_CACHE_VERSION =
  process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';

export function cacheKey(parts: (string | number | boolean | null | undefined)[]): string {
  return [
    'timeline',
    APP_CACHE_VERSION,
    ...parts.map((part) => encodeURIComponent(String(part ?? 'null'))),
  ].join(':');
}

export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const env = getEnv();
  if (!env.REDIS_URL) return load();
  try {
    const redis = getRedisConnection();
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await load();
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  } catch (err) {
    log.warn({ err: (err as Error).message, key }, 'cache_unavailable');
    return load();
  }
}

export async function deleteCacheKey(key: string): Promise<void> {
  const env = getEnv();
  if (!env.REDIS_URL) return;
  try {
    const redis = getRedisConnection();
    await redis.del(key);
  } catch (err) {
    log.warn({ err: (err as Error).message, key }, 'cache_delete_failed');
  }
}
