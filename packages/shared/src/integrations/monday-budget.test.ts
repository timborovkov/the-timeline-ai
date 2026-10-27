import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const state = vi.hoisted(() => ({
  calls: new Map<string, number>(),
  pausedUntil: new Map<string, number>(),
  eval: vi.fn(
    (
      script: string,
      _keys: number,
      key: string,
      second?: string | number,
      third?: string,
      fourth?: string,
    ) => {
      if (script.includes("redis.call('INCRBY'")) {
        const count = state.calls.get(key) ?? 0;
        const accountKey = String(second);
        state.calls.set(accountKey, (state.calls.get(accountKey) ?? 0) + count);
        state.calls.delete(key);
        const tokenPause = state.pausedUntil.get(String(third)) ?? 0;
        const accountPause = state.pausedUntil.get(String(fourth)) ?? 0;
        if (tokenPause > accountPause) state.pausedUntil.set(String(fourth), tokenPause);
        state.pausedUntil.delete(String(third));
        return Promise.resolve(count);
      }
      if (script.includes("redis.call('SET'")) {
        state.pausedUntil.set(key, Number(second));
        return Promise.resolve(1);
      }
      const pause = (state.pausedUntil.get(String(second)) ?? 0) - Math.floor(Date.now() / 1000);
      if (pause > 0) return Promise.resolve(-pause);
      const count = state.calls.get(key) ?? 0;
      if (count >= 100) return Promise.resolve(0);
      state.calls.set(key, count + 1);
      return Promise.resolve(1);
    },
  ),
}));

await vi.mock(
  import.meta.resolve('#src/queue/connection.js'),
  () => ({
    getRedisConnection: () => ({ eval: state.eval }),
  }),
  () => import('#src/queue/connection.js'),
);

const { adoptMondayAccountBudget, observeMondayRemaining, reserveMondayCall } =
  await import('#src/integrations/monday-budget.js');

describe('monday account budget', () => {
  beforeEach(() => {
    state.calls.clear();
    state.pausedUntil.clear();
    state.eval.mockClear();
  });

  it('shares 100 daily reservations across different connection tokens for one account', async () => {
    for (let i = 0; i < 100; i++) {
      await reserveMondayCall('account-1', i % 2 ? 'token-a' : 'token-b');
    }
    await expect(reserveMondayCall('account-1', 'token-c')).rejects.toMatchObject({
      provider: 'monday',
      scope: 'daily',
      reason: 'timeline_daily_budget',
      externalAccountId: 'account-1',
    });
    expect(state.eval).toHaveBeenCalledTimes(101);
    expect([...state.calls.values()]).toEqual([100]);
  });

  it('pauses all account connections until the minute quota resets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'));
    try {
      await reserveMondayCall('account-1', 'token-a');
      await observeMondayRemaining(
        'account-1',
        'token-a',
        new Headers({ ratelimit: '"minuteRate";r=99;t=30, "concurrency";r=35' }),
      );
      await expect(reserveMondayCall('account-1', 'token-b')).rejects.toMatchObject({
        reason: 'timeline_minute_reserve',
        retryAfterSeconds: 30,
      });
      vi.setSystemTime(new Date('2026-06-20T12:00:31.000Z'));
      await expect(reserveMondayCall('account-1', 'token-b')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a fresh account bucket after the UTC day resets', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-20T23:59:59.000Z'));
      for (let i = 0; i < 100; i++) await reserveMondayCall('account-1', 'token-a');
      await expect(reserveMondayCall('account-1', 'token-b')).rejects.toMatchObject({
        reason: 'timeline_daily_budget',
      });
      vi.setSystemTime(new Date('2026-06-21T00:00:00.000Z'));
      await expect(reserveMondayCall('account-1', 'token-b')).resolves.toBeUndefined();
      expect(state.calls.size).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('charges OAuth identity calls to the discovered account', async () => {
    await reserveMondayCall(undefined, 'token-a');
    await adoptMondayAccountBudget('account-1', 'token-a');
    for (let i = 0; i < 99; i++) {
      await reserveMondayCall('account-1', 'token-b');
    }
    await expect(reserveMondayCall('account-1', 'token-c')).rejects.toMatchObject({
      reason: 'timeline_daily_budget',
    });
    expect([...state.calls.values()]).toEqual([100]);
  });

  it('carries the provider minute reserve from OAuth discovery to the account', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00.000Z'));
    try {
      await reserveMondayCall(undefined, 'token-a');
      await observeMondayRemaining(
        undefined,
        'token-a',
        new Headers({ ratelimit: '"minuteRate";r=99;t=30' }),
      );
      await adoptMondayAccountBudget('account-1', 'token-a');
      await expect(reserveMondayCall('account-1', 'token-b')).rejects.toMatchObject({
        reason: 'timeline_minute_reserve',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
