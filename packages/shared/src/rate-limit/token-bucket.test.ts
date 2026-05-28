import { describe, expect, it } from 'vitest';

import type { Redis } from 'ioredis';

import { checkRateLimit, rateLimitKey } from '#src/rate-limit/token-bucket.js';

interface BucketState {
  tokens: number;
  ts: number;
}

/**
 * In-memory stand-in implementing the same semantics as the Lua script.
 * Exercises the wrapper's allow/deny/retry-after math end-to-end.
 */
function makeFakeRedis(): Redis {
  const store = new Map<string, BucketState>();
  const fake = {
    defineCommand: () => undefined,
    tokenBucket: (
      key: string,
      capacityStr: string,
      refillStr: string,
      costStr: string,
      nowStr: string,
      _ttlStr: string,
    ): Promise<[number, string, number]> => {
      const capacity = Number(capacityStr);
      const refill = Number(refillStr);
      const cost = Number(costStr);
      const now = Number(nowStr);
      const existing = store.get(key);
      let tokens = existing?.tokens ?? capacity;
      const ts = existing?.ts ?? now;
      tokens = Math.min(capacity, tokens + Math.max(0, now - ts) * (refill / 1000));
      if (tokens >= cost) {
        tokens -= cost;
        store.set(key, { tokens, ts: now });
        return Promise.resolve([1, String(tokens), 0]);
      }
      const needed = cost - tokens;
      const retry = Math.ceil((needed / Math.max(refill, 0.001)) * 1000);
      store.set(key, { tokens, ts: now });
      return Promise.resolve([0, String(tokens), retry]);
    },
  };
  return fake as unknown as Redis;
}

describe('checkRateLimit', () => {
  it('allows up to capacity then denies with a retry-after', async () => {
    const redis = makeFakeRedis();
    const key = rateLimitKey('test', 'a');
    const config = { key, capacity: 3, refillPerSec: 1 };
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(config, { redis, now: () => now });
      expect(r.ok).toBe(true);
    }
    const blocked = await checkRateLimit(config, { redis, now: () => now });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens over time', async () => {
    const redis = makeFakeRedis();
    const key = rateLimitKey('test', 'b');
    const config = { key, capacity: 2, refillPerSec: 1 };
    let now = 1_000_000;
    await checkRateLimit(config, { redis, now: () => now });
    await checkRateLimit(config, { redis, now: () => now });
    expect((await checkRateLimit(config, { redis, now: () => now })).ok).toBe(false);
    now += 1500;
    expect((await checkRateLimit(config, { redis, now: () => now })).ok).toBe(true);
  });

  it('fail-open when Redis throws', async () => {
    const broken = {
      defineCommand: () => undefined,
      tokenBucket: () => {
        throw new Error('connection refused');
      },
    } as unknown as Redis;
    const r = await checkRateLimit(
      { key: 'rl:x', capacity: 1, refillPerSec: 1 },
      { redis: broken, now: () => 1 },
    );
    expect(r.ok).toBe(true);
  });

  it('rateLimitKey skips empty parts', () => {
    expect(rateLimitKey('chat', 'user', 'abc')).toBe('rl:chat:user:abc');
    expect(rateLimitKey('chat', undefined, 'abc')).toBe('rl:chat:abc');
  });
});
