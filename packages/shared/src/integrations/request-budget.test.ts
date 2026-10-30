import { randomUUID } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { afterAll, describe, it } from 'bun:test';
import IORedis from 'ioredis';

const connection = vi.hoisted(() => ({ current: null as IORedis | null }));
await vi.mock(
  import.meta.resolve('#src/queue/connection.js'),
  () => ({ getRedisConnection: () => connection.current }),
  () => import('#src/queue/connection.js'),
);

const {
  pauseProviderRequests,
  observeProviderCapacity,
  requestBudgetIdentity,
  reserveProviderRequest,
} = await import('#src/integrations/request-budget.js');

// Real Lua execution is opt-in for this suite; use an isolated key prefix, never FLUSHDB.
describe.skipIf(!process.env.TEST_REDIS_URL)('shared request budget with Redis', () => {
  const redis = new IORedis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
  });
  connection.current = redis;
  const keys: string[] = [];
  const key = () => {
    const value = requestBudgetIdentity('linear', `test:${randomUUID()}`);
    keys.push(value);
    return value;
  };
  afterAll(async () => {
    for (const prefix of keys) {
      const found = await redis.keys(`${prefix}:*`);
      if (found.length) await redis.del(...found);
    }
    await redis.quit();
  });
  it('reserves atomically across concurrent callers and isolates accounts', async () => {
    const account = key();
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => reserveProviderRequest('linear', account)),
    );
    const accepted = attempts.filter(
      (value): value is PromiseFulfilledResult<() => Promise<void>> => value.status === 'fulfilled',
    );
    expect(accepted).toHaveLength(4);
    const other = await reserveProviderRequest('linear', key());
    await other();
    await Promise.all(accepted.map((value) => value.value()));
    await (
      await reserveProviderRequest('linear', account)
    )();
  });
  it('atomically spends observed capacity and never replenishes it from stale responses', async () => {
    const account = key();
    const reset = new Date(Date.now() + 60_000);
    await observeProviderCapacity(account, 2, reset);
    const release = await reserveProviderRequest('github', account);
    await observeProviderCapacity(account, 100, reset);
    await release();
    await (
      await reserveProviderRequest('github', account)
    )();
    await expect(reserveProviderRequest('github', account)).rejects.toMatchObject({
      reason: 'shared_request_budget',
    });
    expect(Number(await redis.get(`${account}:remaining`))).toBe(0);
  });
  it('keeps the longer cooldown and enforces pacing after releasing concurrency', async () => {
    const account = key();
    await pauseProviderRequests(account, new Date(Date.now() + 120_000));
    await pauseProviderRequests(account, new Date(Date.now() + 10_000));
    await expect(reserveProviderRequest('linear', account)).rejects.toMatchObject({
      reason: 'shared_request_budget',
    });
    expect(Number(await redis.get(`${account}:pause`))).toBeGreaterThan(Date.now() + 110_000);
    const paced = key();
    await (
      await reserveProviderRequest('slack', paced, 60_000)
    )();
    await expect(reserveProviderRequest('slack', paced, 60_000)).rejects.toMatchObject({
      reason: 'shared_request_budget',
    });
  });
});
