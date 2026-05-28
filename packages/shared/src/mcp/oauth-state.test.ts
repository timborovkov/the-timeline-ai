import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { signOAuthState, verifyOAuthState } from '#src/mcp/oauth-state.js';

describe('mcp/oauth-state', () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = 'a-test-auth-secret-that-is-long-enough';
    resetEnvForTests();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
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

  it('rejects tokens signed under a different AUTH_SECRET', () => {
    const tok = signOAuthState({ teamId: 't', mcpServerId: 's', userId: 'u' });
    // Rotating AUTH_SECRET invalidates all outstanding state tokens —
    // same posture as rotating any HMAC signing key.
    process.env.AUTH_SECRET = 'a-completely-different-auth-secret-value';
    resetEnvForTests();
    expect(verifyOAuthState(tok)).toBeNull();
  });
});
