import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySlackSignature } from './security.js';

describe('verifySlackSignature', () => {
  it('accepts a valid v0 Slack signature', () => {
    const signingSecret = 'secret';
    const timestamp = '1716717600';
    const body = '{"type":"event_callback"}';
    const base = `v0:${timestamp}:${body}`;
    const signature = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;

    expect(
      verifySlackSignature({
        signingSecret,
        timestamp,
        signature,
        body,
        nowSeconds: 1716717600,
      }),
    ).toBe(true);
  });

  it('rejects stale timestamps and bad signatures', () => {
    expect(
      verifySlackSignature({
        signingSecret: 'secret',
        timestamp: '1716710000',
        signature: 'v0=bad',
        body: '{}',
        nowSeconds: 1716717600,
      }),
    ).toBe(false);
  });
});
