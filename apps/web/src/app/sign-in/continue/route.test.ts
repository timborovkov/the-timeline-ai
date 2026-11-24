import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { GET } from '@/app/sign-in/continue/route';

// Only a browser navigation can attach scoped display preferences to the destination.
describe('credential sign-in continuation', () => {
  function request(callbackUrl: string) {
    const url = new URL('/sign-in/continue', 'http://localhost:3000');
    url.searchParams.set('callbackUrl', callbackUrl);
    return new Request(url);
  }

  it.each([
    [
      '/app/team?section=billing&plan=team#change-plan',
      '/app/team?section=billing&amp;plan=team#change-plan',
    ],
    [
      '/guest/11111111-1111-4111-8111-111111111111?record=fixture',
      '/guest/11111111-1111-4111-8111-111111111111?record=fixture',
    ],
    ['/accept-invite/synthetic-token?next=%2Fapp', '/accept-invite/synthetic-token?next=%2Fapp'],
    ['/app?x=&quot;', '/app?x=&amp;quot;'],
  ])('preserves the complete same-origin destination %s', async (callback, escaped) => {
    const response = GET(request(callback));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.has('location')).toBe(false);
    const html = await response.text();
    expect(html).toContain(`http-equiv="refresh" content="0;url=${escaped}"`);
    expect(html).toContain(`href="${escaped}"`);
  });

  it.each([
    'https://outside.example.test/',
    '//outside.example.test',
    String.raw`/\outside.example.test`,
    '/sign-in/continue',
  ])('falls back to the app for %s', async (callback) => {
    const response = await GET(request(callback)).text();
    expect(response).toContain('http-equiv="refresh" content="0;url=/app"');
    expect(response).toContain('href="/app"');
  });
});
