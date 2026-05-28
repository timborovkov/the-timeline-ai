import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySvixSignature } from '#src/meeting-bots/svix.js';

function sign(secret: string, id: string, ts: number, body: string): string {
  const stripped = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  // Mirror the verifier: try base64-decode first, fall back to utf8.
  const decoded = Buffer.from(stripped, 'base64');
  return createHmac('sha256', decoded)
    .update(`${id}.${String(ts)}.${body}`)
    .digest('base64');
}

describe('verifySvixSignature', () => {
  // Use a proper whsec_ secret so verifier and signer agree on decoding.
  const secret = `whsec_${Buffer.from('mysecret').toString('base64')}`;
  const body = '{"event":"bot.call_ended"}';
  const id = 'msg_123';
  const now = new Date('2026-05-25T10:00:00Z');
  const ts = Math.floor(now.getTime() / 1000);

  it('accepts a valid v1 signature', () => {
    const sig = sign(secret, id, ts, body);
    const headers = new Headers({
      'svix-id': id,
      'svix-timestamp': String(ts),
      'svix-signature': `v1,${sig}`,
    });
    const result = verifySvixSignature({ body, headers, secret, now: () => now });
    expect(result.ok).toBe(true);
  });

  it('accepts webhook-* header aliases', () => {
    const sig = sign(secret, id, ts, body);
    const headers = new Headers({
      'webhook-id': id,
      'webhook-timestamp': String(ts),
      'webhook-signature': `v1,${sig}`,
    });
    const result = verifySvixSignature({ body, headers, secret, now: () => now });
    expect(result.ok).toBe(true);
  });

  it('rejects when signature is wrong', () => {
    const headers = new Headers({
      'svix-id': id,
      'svix-timestamp': String(ts),
      'svix-signature': 'v1,AAAAAAAAAAAAAAAA',
    });
    const result = verifySvixSignature({ body, headers, secret, now: () => now });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects when timestamp is stale', () => {
    const oldTs = ts - 3600;
    const sig = sign(secret, id, oldTs, body);
    const headers = new Headers({
      'svix-id': id,
      'svix-timestamp': String(oldTs),
      'svix-signature': `v1,${sig}`,
    });
    const result = verifySvixSignature({ body, headers, secret, now: () => now });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('stale_timestamp');
  });

  it('rejects when headers are missing', () => {
    const headers = new Headers({ 'svix-id': id });
    const result = verifySvixSignature({ body, headers, secret, now: () => now });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_headers');
  });
});
