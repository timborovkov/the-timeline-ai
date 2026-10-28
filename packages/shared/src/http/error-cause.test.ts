import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { formatErrorCause } from '#src/http/error-cause.js';
describe('formatErrorCause', () => {
  it('includes code, errno, syscall, and host from the cause chain', () => {
    const leaf = Object.assign(new Error('connect ECONNREFUSED 140.82.112.6:443'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '140.82.112.6',
      port: 443,
    });
    const mid = new TypeError('fetch failed', { cause: leaf });
    const outer = Object.assign(new Error('External request failed', { cause: mid }), {
      code: 'network_failure',
    });

    expect(formatErrorCause(outer)).toBe(
      'Error External request failed code=network_failure [cause: TypeError fetch failed [cause: Error connect ECONNREFUSED 140.82.112.6:443 code=ECONNREFUSED errno=-111 syscall=connect address=140.82.112.6 port=443]]',
    );
  });

  it('redacts bot tokens and bearer secrets in the flattened text', () => {
    const err = new Error(
      'GET https://api.telegram.org/bot123456:ABC-secret/setWebhook failed Bearer gho_secretToken',
    );
    expect(formatErrorCause(err)).toContain('<redacted>');
    expect(formatErrorCause(err)).not.toContain('ABC-secret');
    expect(formatErrorCause(err)).not.toContain('gho_secretToken');
  });
});
