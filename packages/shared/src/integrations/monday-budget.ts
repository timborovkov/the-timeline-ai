import { createHash } from 'node:crypto';

import { ProviderRateLimitError } from '#src/integrations/types.js';
import { getRedisConnection } from '#src/queue/connection.js';

const DAILY_CALL_CAP = 100;
const RESERVE_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local pause = redis.call('TTL', KEYS[2])
if pause > 0 then return -pause end
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], tonumber(ARGV[2]))
return 1
`;
const PAUSE_SCRIPT = `
local existing = redis.call('EXPIRETIME', KEYS[1])
if existing < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], '1')
  redis.call('EXPIREAT', KEYS[1], tonumber(ARGV[1]))
end
return 1
`;
const ADOPT_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then
  redis.call('INCRBY', KEYS[2], count)
  redis.call('EXPIREAT', KEYS[2], tonumber(ARGV[1]))
  redis.call('DEL', KEYS[1])
end
local tokenPause = redis.call('EXPIRETIME', KEYS[3])
local accountPause = redis.call('EXPIRETIME', KEYS[4])
if tokenPause > accountPause then
  redis.call('SET', KEYS[4], '1')
  redis.call('EXPIREAT', KEYS[4], tokenPause)
end
redis.call('DEL', KEYS[3])
return count
`;

function budgetKey(accountId: string | undefined, accessToken: string, now: Date): string {
  return `monday:daily:${now.toISOString().slice(0, 10)}:${budgetIdentity(accountId, accessToken)}`;
}

function budgetIdentity(accountId: string | undefined, accessToken: string): string {
  return accountId ?? createHash('sha256').update(accessToken).digest('hex');
}

function resetAtUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

export async function adoptMondayAccountBudget(
  accountId: string,
  accessToken: string,
): Promise<void> {
  const now = new Date();
  await getRedisConnection().eval(
    ADOPT_SCRIPT,
    4,
    budgetKey(undefined, accessToken, now),
    budgetKey(accountId, accessToken, now),
    `monday:minute:${budgetIdentity(undefined, accessToken)}`,
    `monday:minute:${budgetIdentity(accountId, accessToken)}`,
    Math.ceil(resetAtUtc(now) / 1000),
  );
}

export async function observeMondayRemaining(
  accountId: string | undefined,
  accessToken: string,
  headers: Headers,
): Promise<void> {
  // monday's documented RateLimit header reports minute, concurrency and
  // complexity policies; it does not expose the account's daily remainder.
  const minutePolicy = headers
    .get('ratelimit')
    ?.split(',')
    .find((policy) => /^\s*"?minuteRate"?\s*;/i.test(policy));
  if (!minutePolicy) return;
  const remaining = /(?:^|;)\s*r=(\d+)/i.exec(minutePolicy)?.[1];
  if (!remaining || Number(remaining) >= DAILY_CALL_CAP) return;
  const resetSeconds = Number(/(?:^|;)\s*t=(\d+)/i.exec(minutePolicy)?.[1] ?? 60);
  await getRedisConnection().eval(
    PAUSE_SCRIPT,
    1,
    `monday:minute:${budgetIdentity(accountId, accessToken)}`,
    Math.ceil(Date.now() / 1000) + Math.max(1, resetSeconds),
  );
}

export async function reserveMondayCall(
  accountId: string | undefined,
  accessToken: string,
): Promise<void> {
  // OAuth identity lookups run before the account id is known. Group those
  // initial calls by token, then share the account bucket after connection.
  const now = new Date();
  const resetAt = resetAtUtc(now);
  const allowed = await getRedisConnection().eval(
    RESERVE_SCRIPT,
    2,
    budgetKey(accountId, accessToken, now),
    `monday:minute:${budgetIdentity(accountId, accessToken)}`,
    DAILY_CALL_CAP,
    Math.ceil(resetAt / 1000),
  );
  if (Number(allowed) === 1) return;
  if (Number(allowed) < 0) {
    const waitSeconds = Math.abs(Number(allowed));
    const retryAt = new Date(Date.now() + waitSeconds * 1000);
    throw new ProviderRateLimitError({
      provider: 'monday',
      retryAt,
      retryAfterSeconds: waitSeconds,
      scope: 'minute',
      reason: 'timeline_minute_reserve',
      ...(accountId ? { externalAccountId: accountId } : {}),
      message: `Monday sync paused for Timeline API budget (minute reserve) until ${retryAt.toISOString()}`,
    });
  }
  const retryAt = new Date(resetAt);
  throw new ProviderRateLimitError({
    provider: 'monday',
    retryAt,
    retryAfterSeconds: Math.ceil((resetAt - Date.now()) / 1000),
    scope: 'daily',
    reason: 'timeline_daily_budget',
    ...(accountId ? { externalAccountId: accountId } : {}),
    message: `Monday sync paused for Timeline API budget until ${retryAt.toISOString()}`,
  });
}
