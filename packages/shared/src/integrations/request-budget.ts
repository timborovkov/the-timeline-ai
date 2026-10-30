import { createHash, randomUUID } from 'node:crypto';

import { ProviderRateLimitError, type NativeProviderId } from '#src/integrations/types.js';
import { getRedisConnection } from '#src/queue/connection.js';

const RESERVE = `
local now = tonumber(ARGV[1])
local pause = tonumber(redis.call('GET', KEYS[1]) or '0')
if pause > now then return pause end
local next = tonumber(redis.call('GET', KEYS[4]) or '0')
if next > now then return next end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= 4 then return now + 1000 end
local capacity = tonumber(redis.call('GET', KEYS[5]) or '-1')
if capacity == 0 then return tonumber(redis.call('GET', KEYS[6]) or now + 60000) end
if capacity > 0 then redis.call('DECR', KEYS[5]) end
redis.call('ZADD', KEYS[2], now + 120000, ARGV[2])
redis.call('PEXPIRE', KEYS[2], 120000)
if tonumber(ARGV[3]) > 0 then redis.call('SET', KEYS[4], now + tonumber(ARGV[3]), 'PX', ARGV[3]) end
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], 172800)
return 0
`;
const PAUSE = `
local previous = tonumber(redis.call('GET', KEYS[1]) or '0')
if tonumber(ARGV[1]) > previous then
  redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[1])
end
return 1
`;

export function requestBudgetIdentity(
  provider: NativeProviderId | 'telegram' | 'mcp',
  identity: string,
): string {
  return `provider-request:${provider}:${createHash('sha256').update(identity).digest('hex')}`;
}

export async function reserveProviderRequest(
  provider: NativeProviderId | 'telegram' | 'mcp',
  key: string,
  intervalMs = 0,
  externalAccountId?: string,
): Promise<() => Promise<void>> {
  const token = randomUUID();
  const now = Date.now();
  const retry = Number(
    await getRedisConnection().eval(
      RESERVE,
      6,
      `${key}:pause`,
      `${key}:active`,
      `${key}:usage:${new Date(now).toISOString().slice(0, 10)}`,
      `${key}:next`,
      `${key}:remaining`,
      `${key}:reset`,
      now,
      token,
      intervalMs,
    ),
  );
  if (retry > now && (provider === 'telegram' || provider === 'mcp'))
    throw Object.assign(new Error(`${provider} request budget paused`), {
      retryAt: new Date(retry),
    });
  if (retry > now && provider !== 'telegram' && provider !== 'mcp')
    throw new ProviderRateLimitError({
      provider,
      scope: 'requests',
      reason: 'shared_request_budget',
      ...(externalAccountId ? { externalAccountId } : {}),
      retryAt: new Date(retry),
      retryAfterSeconds: Math.ceil((retry - now) / 1000),
    });
  return async () => {
    await getRedisConnection().zrem(`${key}:active`, token);
  };
}

export async function pauseProviderRequests(key: string, retryAt: Date): Promise<void> {
  await getRedisConnection().eval(PAUSE, 1, `${key}:pause`, retryAt.getTime());
}

/** Conservative observations: out-of-order responses can only reduce a live allowance. */
export async function observeProviderCapacity(
  key: string,
  remaining: number,
  resetAt: Date,
): Promise<void> {
  if (
    !Number.isFinite(remaining) ||
    !Number.isFinite(resetAt.getTime()) ||
    resetAt.getTime() <= Date.now()
  )
    return;
  await getRedisConnection().eval(
    `
local reset = tonumber(redis.call('GET', KEYS[2]) or '0')
local observed = math.max(0, tonumber(ARGV[1]) - redis.call('ZCARD', KEYS[3]))
local previous = tonumber(redis.call('GET', KEYS[1]) or '-1')
if reset > 0 and previous >= 0 then observed = math.min(previous, observed) end
local untilTime = math.max(reset, tonumber(ARGV[2]))
redis.call('SET', KEYS[1], observed, 'PXAT', untilTime)
redis.call('SET', KEYS[2], untilTime, 'PXAT', untilTime)
return 1
`,
    3,
    `${key}:remaining`,
    `${key}:reset`,
    `${key}:active`,
    Math.floor(remaining),
    resetAt.getTime(),
  );
}
