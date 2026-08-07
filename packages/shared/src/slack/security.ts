import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { requireAuthSecret } from '#src/env.js';

const MAX_SKEW_SECONDS = 5 * 60;

export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
}): boolean {
  if (!input.timestamp || !input.signature) return false;
  const ts = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;
  const base = `v0:${input.timestamp}:${input.body}`;
  const expected = `v0=${createHmac('sha256', input.signingSecret).update(base).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SlackOAuthState {
  kind: 'install' | 'user_link';
  teamId: string;
  userId: string;
  nonce: string;
  createdAt: number;
}

function stateSecret(): string {
  return requireAuthSecret();
}

export function signSlackOAuthState(input: Omit<SlackOAuthState, 'nonce' | 'createdAt'>): string {
  const payload: SlackOAuthState = {
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    createdAt: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySlackOAuthState(raw: string, maxAgeMs = 15 * 60 * 1000): SlackOAuthState {
  const dot = raw.indexOf('.');
  const body = dot === -1 ? '' : raw.slice(0, dot);
  const sig = dot === -1 ? '' : raw.slice(dot + 1);
  if (!body || !sig) throw new Error('invalid_state');
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid_state');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlackOAuthState;
  if (Date.now() - parsed.createdAt > maxAgeMs) throw new Error('expired_state');
  return parsed;
}
