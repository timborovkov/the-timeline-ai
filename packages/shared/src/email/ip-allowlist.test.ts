import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders, isIpAllowed, parseCidrList } from './ip-allowlist.js';

describe('parseCidrList', () => {
  it('parses bare ip and /N', () => {
    const list = parseCidrList('1.2.3.4, 10.0.0.0/8, garbage, 999.0.0.0, 5.5.5.5/40');
    expect(list).toHaveLength(2);
  });
});

describe('isIpAllowed', () => {
  const list = parseCidrList('1.2.3.4, 10.0.0.0/8, 192.168.1.0/24');
  it('exact /32 match', () => {
    expect(isIpAllowed('1.2.3.4', list)).toBe(true);
    expect(isIpAllowed('1.2.3.5', list)).toBe(false);
  });
  it('CIDR range match', () => {
    expect(isIpAllowed('10.255.255.255', list)).toBe(true);
    expect(isIpAllowed('11.0.0.0', list)).toBe(false);
    expect(isIpAllowed('192.168.1.42', list)).toBe(true);
    expect(isIpAllowed('192.168.2.1', list)).toBe(false);
  });
  it('rejects null and malformed', () => {
    expect(isIpAllowed(null, list)).toBe(false);
    expect(isIpAllowed('not-an-ip', list)).toBe(false);
  });
});

describe('clientIpFromHeaders', () => {
  it('prefers cloudflare connecting ip', () => {
    const h = new Headers({
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
    });
    expect(clientIpFromHeaders(h)).toBe('9.9.9.9');
  });
  it('takes first hop from x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
    expect(clientIpFromHeaders(h)).toBe('1.2.3.4');
  });
  it('falls back to x-real-ip', () => {
    const h = new Headers({ 'x-real-ip': '5.6.7.8' });
    expect(clientIpFromHeaders(h)).toBe('5.6.7.8');
  });
  it('returns null when nothing is set', () => {
    expect(clientIpFromHeaders(new Headers())).toBe(null);
  });
});
