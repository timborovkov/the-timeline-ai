import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientIpFromHeaders } from '@/lib/request-ip';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientIpFromHeaders', () => {
  it('prefers Railway-proxy X-Real-IP over caller-supplied forwarding headers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const headers = new Headers({
      'x-real-ip': '203.0.113.10',
      'cf-connecting-ip': '198.51.100.11',
      'x-forwarded-for': '198.51.100.12, 10.0.0.1',
    });

    expect(clientIpFromHeaders(headers)).toBe('203.0.113.10');
  });

  it('does not trust fallback forwarding headers in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const headers = new Headers({
      'x-real-ip': 'not-an-ip',
      'cf-connecting-ip': '198.51.100.11',
      'x-forwarded-for': '198.51.100.12, 10.0.0.1',
    });

    expect(clientIpFromHeaders(headers)).toBeNull();
  });

  it('keeps common proxy-header fallback for local development', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '198.51.100.12, 10.0.0.1' }))).toBe(
      '198.51.100.12',
    );
  });
});
