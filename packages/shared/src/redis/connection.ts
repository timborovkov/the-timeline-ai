import IORedis, { type Redis } from 'ioredis';

import { getEnv } from '#src/env.js';

export type RedisConsumerRole = 'queue' | 'request';
const connections = new Map<RedisConsumerRole, Redis>();

/**
 * Infrastructure-owned Redis connections, isolated by consumer lifecycle. `maxRetriesPerRequest: null` is
 * retained for both roles; required by BullMQ workers (blocking BRPOPLPUSH calls would otherwise
 * fail under retry). `lazyConnect` keeps test environments from opening a
 * socket on import.
 */
export function getRedisConnection(role: RedisConsumerRole = 'request'): Redis {
  const existing = connections.get(role);
  if (existing) return existing;
  const env = getEnv();
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the job queue');
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    // ioredis 6 defaults to RESP3. Keep legacy reply shapes so BullMQ 5 and
    // string get/set/Lua callers stay on the v5 mapping.
    protocol: 3,
    replyMapping: 'legacy',
  });
  connections.set(role, connection);
  return connection;
}

export async function closeRedisConnection(role: RedisConsumerRole = 'request'): Promise<void> {
  const connection = connections.get(role);
  if (!connection) return;
  connections.delete(role);
  await connection.quit().catch(() => undefined);
}

export async function closeAllRedisConnections(): Promise<void> {
  await Promise.all([...connections.keys()].map(closeRedisConnection));
}
