import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '#src/env.js';

// Phase 11 — Minimal stateful JWT-equivalent for the MCP OAuth dance.
// Carries (teamId, mcpServerId, userId, issuedAt) and is HS256-MACed
// with AUTH_SECRET — same secret NextAuth uses to sign session cookies,
// so anyone with access to AUTH_SECRET could already forge sessions.
// We don't pull in `jose` because the requirements are trivial and
// adding the dep just for this is not worth it.
//
// Format: base64url(payload).base64url(sig)
// where sig = HMAC-SHA256(secret, payload) and payload = base64url(json).

interface OAuthStatePayload {
  teamId: string;
  mcpServerId: string;
  userId: string;
  /** Unix ms when issued. */
  iat: number;
  /** Unix ms when expires. */
  exp: number;
}

const STATE_TTL_MS = 15 * 60 * 1000;

function getSecret(): string {
  const env = getEnv();
  // AUTH_SECRET is already validated as a required, non-empty string in
  // env.ts (min 16 chars) so this never throws in a well-configured env.
  return env.AUTH_SECRET;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(padded, 'base64');
}

export function signOAuthState(input: {
  teamId: string;
  mcpServerId: string;
  userId: string;
}): string {
  const now = Date.now();
  const payload: OAuthStatePayload = {
    teamId: input.teamId,
    mcpServerId: input.mcpServerId,
    userId: input.userId,
    iat: now,
    exp: now + STATE_TTL_MS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyOAuthState(token: string): OAuthStatePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest();
  let providedSig: Buffer;
  try {
    providedSig = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8')) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (Date.now() > payload.exp) return null;
  return payload;
}
