import { childLogger } from '../logger.js';
import { getRedisConnection } from '../queue/connection.js';

import type { Redis } from 'ioredis';

const log = childLogger('shared:rate-limit');

export interface RateLimitInput {
  /** Fully-qualified bucket key, e.g. `rl:search:user:abc`. */
  key: string;
  /** Maximum tokens the bucket holds (also the initial fill). */
  capacity: number;
  /** Tokens replenished per second. */
  refillPerSec: number;
  /** Tokens to consume on this call. Defaults to 1. */
  cost?: number;
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number; remaining: number };

/**
 * Atomic token-bucket check. The Lua script runs entirely server-side so two
 * concurrent webs can't both pass when only one token is left.
 *
 * State stored as a Redis hash: { tokens: float, ts: ms }. Hash TTL is
 * `ceil(capacity / refill) * 2` seconds, long enough that a fully-drained
 * bucket still refills correctly across idle gaps but short enough that
 * abandoned keys disappear.
 */
const SCRIPT = `
local tokens_key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local ttl_s = tonumber(ARGV[5])

local data = redis.call('HMGET', tokens_key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed_ms = math.max(0, now_ms - ts)
local refilled = tokens + (elapsed_ms / 1000) * refill
if refilled > capacity then refilled = capacity end

local allowed = 0
local retry_ms = 0
if refilled >= cost then
  refilled = refilled - cost
  allowed = 1
else
  local needed = cost - refilled
  if refill > 0 then
    retry_ms = math.ceil((needed / refill) * 1000)
  else
    retry_ms = 1000
  end
end

redis.call('HMSET', tokens_key, 'tokens', tostring(refilled), 'ts', tostring(now_ms))
redis.call('EXPIRE', tokens_key, ttl_s)
return { allowed, tostring(refilled), retry_ms }
`;

let _scriptLoaded: WeakSet<Redis> | undefined;

function ensureScript(conn: Redis): void {
  _scriptLoaded ??= new WeakSet();
  if (_scriptLoaded.has(conn)) return;
  const c = conn as Redis & {
    defineCommand: (name: string, opts: { numberOfKeys: number; lua: string }) => void;
    tokenBucket?: unknown;
  };
  if (typeof c.tokenBucket !== 'function') {
    c.defineCommand('tokenBucket', { numberOfKeys: 1, lua: SCRIPT });
  }
  _scriptLoaded.add(conn);
}

export async function checkRateLimit(
  input: RateLimitInput,
  deps: { redis?: Redis; now?: () => number } = {},
): Promise<RateLimitResult> {
  const conn = deps.redis ?? getRedisConnection();
  const now = deps.now?.() ?? Date.now();
  const cost = input.cost ?? 1;
  const ttl = Math.max(60, Math.ceil((input.capacity / Math.max(input.refillPerSec, 0.001)) * 2));

  try {
    ensureScript(conn);
    const raw = (await (
      conn as unknown as { tokenBucket: (...args: unknown[]) => Promise<unknown> }
    ).tokenBucket(
      input.key,
      String(input.capacity),
      String(input.refillPerSec),
      String(cost),
      String(now),
      String(ttl),
    )) as [number, string, number];
    const allowed = raw[0] === 1;
    const remaining = Math.floor(Number(raw[1]));
    if (allowed) return { ok: true, remaining };
    return { ok: false, retryAfterMs: raw[2], remaining };
  } catch (err) {
    // Fail-open: a Redis hiccup must not take the API down. Log and allow.
    // Operational signal: monitor `rate_limit_error` rate to catch outages
    // that would otherwise hide a real attack.
    log.warn({ err: (err as Error).message, key: input.key }, 'rate_limit_error');
    return { ok: true, remaining: input.capacity };
  }
}

/** Build a namespaced key. Components are joined with `:` and not escaped. */
export function rateLimitKey(...parts: (string | number | undefined | null)[]): string {
  return ['rl', ...parts.filter((p) => p !== undefined && p !== null && p !== '')].join(':');
}
