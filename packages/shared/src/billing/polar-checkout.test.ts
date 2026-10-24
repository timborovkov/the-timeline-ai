import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPolarBillingProvider } from '#src/billing/polar.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('expireCheckout', () => {
  it('treats a missing or finished checkout as expired and a paid one as already paid', async () => {
    const provider = createPolarBillingProvider({ accessToken: 'polar-test', server: 'sandbox' });
    if (!provider) throw new Error('provider');
    const fetchMock = vi.fn((input: URL | string) => {
      const url = String(input);
      if (url.endsWith('/checkouts/missing'))
        return Promise.resolve(new Response('', { status: 404 }));
      if (url.endsWith('/checkouts/gone')) {
        return Promise.resolve(jsonResponse({ status: 'expired' }));
      }
      if (url.endsWith('/checkouts/paid')) {
        return Promise.resolve(jsonResponse({ status: 'succeeded' }));
      }
      return Promise.resolve(jsonResponse({ status: 'confirmed' }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(provider.expireCheckout('missing')).resolves.toBe('expired');
    await expect(provider.expireCheckout('gone')).resolves.toBe('expired');
    await expect(provider.expireCheckout('paid')).resolves.toBe('already_paid');
    await expect(provider.expireCheckout('confirmed')).resolves.toBe('already_paid');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('expires an open checkout only when Polar reports it expired', async () => {
    const provider = createPolarBillingProvider({ accessToken: 'polar-test', server: 'sandbox' });
    if (!provider) throw new Error('provider');
    const fetchMock = vi.fn((input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PATCH' && url.endsWith('/checkouts/open-stays')) {
        return Promise.resolve(jsonResponse({ status: 'open' }));
      }
      if (init?.method === 'PATCH' && url.endsWith('/checkouts/open-expires')) {
        return Promise.resolve(jsonResponse({ status: 'expired' }));
      }
      if (init?.method === 'PATCH' && url.endsWith('/checkouts/open-rejected')) {
        return Promise.resolve(new Response('{"detail":"unknown field"}', { status: 422 }));
      }
      return Promise.resolve(jsonResponse({ status: 'open' }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(provider.expireCheckout('open-stays')).resolves.toBe('still_open');
    await expect(provider.expireCheckout('open-expires')).resolves.toBe('expired');
    await expect(provider.expireCheckout('open-rejected')).resolves.toBe('still_open');
    const patchBodies = fetchMock.mock.calls
      .filter((call) => call[1]?.method === 'PATCH')
      .map((call) => {
        const body = call[1]?.body;
        return typeof body === 'string' ? body : '';
      });
    expect(patchBodies).toEqual([
      JSON.stringify({ expires_at: '1970-01-01T00:00:00.000Z' }),
      JSON.stringify({ expires_at: '1970-01-01T00:00:00.000Z' }),
      JSON.stringify({ expires_at: '1970-01-01T00:00:00.000Z' }),
    ]);
  });
});
