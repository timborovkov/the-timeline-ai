import { createHmac, timingSafeEqual } from 'node:crypto';

import { cookies } from 'next/headers';

const COOKIE_NAME = 'pending_invite';
const TTL_MS = 15 * 60 * 1000;

interface SignedPayload {
  token: string;
  exp: number;
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is required');
  return s;
}

function sign(payload: SignedPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(value: string): SignedPayload | null {
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const body = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return null;
  }
  if (typeof parsed.token !== 'string' || typeof parsed.exp !== 'number') return null;
  if (parsed.exp < Date.now()) return null;
  return parsed;
}

/**
 * Stash a pending invite token in a signed, httpOnly cookie. Set before
 * redirecting into OAuth — `createUser` reads it on the callback to skip
 * the default solo-team creation when the user is joining an existing team.
 */
export async function setPendingInvite(token: string): Promise<void> {
  const value = sign({ token, exp: Date.now() + TTL_MS });
  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_MS / 1000,
  });
}

export async function readPendingInvite(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const verified = verify(raw);
  return verified?.token ?? null;
}

export async function clearPendingInvite(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
