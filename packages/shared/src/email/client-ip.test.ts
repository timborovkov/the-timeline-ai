import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { clientIpFromHeaders } from '#src/email/client-ip.js';

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
