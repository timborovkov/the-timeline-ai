import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type Db, mcpOutboundKeys } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';

// Phase 11 — Timeline-as-MCP-server bearer keys. The plaintext shape is
// `tla_<32 url-safe base64 bytes>` so the prefix `tla_xxxxx…` is easy to
// recognise in logs without identifying which key it is.
const PREFIX = 'tla_';

export interface MintedKey {
  /** Plaintext key shown to the user exactly once. */
  plaintext: string;
  /** Public prefix stored alongside the hash for UI display. */
  prefix: string;
  /** SHA-256 hex of the plaintext. */
  hash: string;
}

export function mintKey(): MintedKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, PREFIX.length + 8);
  return { plaintext, prefix, hash };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface ResolvedKey {
  teamId: string;
  keyId: string;
  scopes: string[];
}

/**
 * Look up a bearer token in `mcp_outbound_keys`. Returns the team-id
 * the key authorises plus the granted scopes, or null when the token is
 * unknown, revoked, or expired. Comparison uses timingSafeEqual on the
 * SHA-256 hex to avoid leaking timing information about which prefix
 * matched (the unique index lookup is constant-time anyway, but the
 * compare-after-lookup keeps the contract honest).
 */
export async function resolveBearerKey(db: Db, token: string): Promise<ResolvedKey | null> {
  if (!token.startsWith(PREFIX)) return null;
  const hash = hashKey(token);
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.keyHash, hash), isNull(mcpOutboundKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Defense in depth — the unique-index hit already proves equality, but
  // a future change that loosens the predicate would benefit from this
  // explicit compare.
  const a = Buffer.from(row.keyHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Best-effort last-used timestamp; we don't await so the request path
  // stays fast on busy keys.
  void db
    .update(mcpOutboundKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpOutboundKeys.id, row.id))
    .catch(() => undefined);
  return {
    teamId: row.teamId,
    keyId: row.id,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : ['read'],
  };
}
