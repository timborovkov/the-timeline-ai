import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import {
  signSlackOAuthState,
  verifySlackOAuthState,
  verifySlackSignature,
} from '#src/slack/security.js';

beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(32);
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
  resetEnvForTests();
});

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

describe('verifySlackOAuthState', () => {
  it('round-trips signed OAuth state', () => {
    const raw = signSlackOAuthState({
      kind: 'install',
      teamId: '11111111-1111-1111-1111-111111111111',
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(verifySlackOAuthState(raw)).toMatchObject({
      kind: 'install',
      teamId: '11111111-1111-1111-1111-111111111111',
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });

  it('treats everything after the first dot as the signature segment', () => {
    const raw = signSlackOAuthState({
      kind: 'user_link',
      teamId: '11111111-1111-1111-1111-111111111111',
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });

    expect(() => verifySlackOAuthState(`${raw}.extra`)).toThrow('invalid_state');
  });
});
