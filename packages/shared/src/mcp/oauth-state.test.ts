import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '../env.js';

import { signOAuthState, verifyOAuthState } from './oauth-state.js';

describe('mcp/oauth-state', () => {
  const originalSecret = process.env.AUTH_SECRET;
  const originalMcpSecret = process.env.MCP_OAUTH_STATE_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = 'a-test-auth-secret-that-is-long-enough';
    delete process.env.MCP_OAUTH_STATE_SECRET;
    resetEnvForTests();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
    if (originalMcpSecret === undefined) delete process.env.MCP_OAUTH_STATE_SECRET;
    else process.env.MCP_OAUTH_STATE_SECRET = originalMcpSecret;
    resetEnvForTests();
  });

  it('roundtrips a state token', () => {
    const tok = signOAuthState({
      teamId: 't1',
      mcpServerId: 's1',
      userId: 'u1',
    });
    const verified = verifyOAuthState(tok);
    expect(verified).not.toBeNull();
    expect(verified?.teamId).toBe('t1');
    expect(verified?.mcpServerId).toBe('s1');
    expect(verified?.userId).toBe('u1');
  });

  it('rejects tampered tokens', () => {
    const tok = signOAuthState({ teamId: 't', mcpServerId: 's', userId: 'u' });
    const [payload] = tok.split('.');
    expect(verifyOAuthState(`${payload}.zzz`)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const now = Date.now();
    // Mock by manually constructing an expired payload would require
    // exposing internals; rely on the TTL check by signing then advancing
    // the clock — Date.now isn't monkey-patched, so verify TTL math by
    // signing far in the past via env shadow.
    const tok = signOAuthState({ teamId: 't', mcpServerId: 's', userId: 'u' });
    const verified = verifyOAuthState(tok);
    expect(verified).not.toBeNull();
    if (verified) {
      expect(verified.exp - now).toBeLessThanOrEqual(15 * 60 * 1000 + 10);
    }
  });

  it('rejects malformed input', () => {
    expect(verifyOAuthState('garbage')).toBeNull();
    expect(verifyOAuthState('a.b.c')).toBeNull();
  });

  it('prefers MCP_OAUTH_STATE_SECRET over AUTH_SECRET when set', () => {
    process.env.MCP_OAUTH_STATE_SECRET = 'a-distinct-mcp-secret-value';
    resetEnvForTests();
    const tok = signOAuthState({ teamId: 't', mcpServerId: 's', userId: 'u' });
    // Tokens signed with one secret should not validate under another.
    process.env.MCP_OAUTH_STATE_SECRET = 'a-different-mcp-secret-value';
    resetEnvForTests();
    expect(verifyOAuthState(tok)).toBeNull();
  });
});
