import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  createPolarBillingProvider,
  polarCustomerByExternalIdPath,
  polarCustomerIdForExternalId,
} from '#src/billing/polar.js';

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
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function polarProvider() {
  const provider = createPolarBillingProvider({ accessToken: 'polar-test', server: 'sandbox' });
  if (!provider) throw new Error('provider');
  return provider;
}

function requestUrl(input: URL | string): string {
  return String(input);
}

describe('polar customer external id', () => {
  it('encodes the external id into the get-by-external-id path', () => {
    expect(polarCustomerByExternalIdPath('a/b c')).toBe('/customers/external/a%2Fb%20c');
    expect(polarCustomerIdForExternalId({ id: 'cus_1', external_id: 'team-1' }, 'team-1')).toBe(
      'cus_1',
    );
    expect(() =>
      polarCustomerIdForExternalId({ id: 'cus_other', external_id: 'other' }, 'team-1'),
    ).toThrow('Polar customer external_id does not match this workspace');
    expect(() => polarCustomerIdForExternalId({ external_id: 'team-1' }, 'team-1')).toThrow(
      'Polar customer response is missing an id',
    );
  });

  it('loads the matching customer by external id and does not create one', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn((input: URL | string, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return Promise.resolve(jsonResponse({ id: 'cus_workspace', external_id: WORKSPACE_ID }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
      }),
    ).resolves.toEqual({ id: 'cus_workspace' });
    expect(calls).toEqual([
      `GET https://sandbox-api.polar.sh/v1/customers/external/${WORKSPACE_ID}`,
    ]);
  });

  it('creates a customer only after the external-id lookup returns 404', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn((input: URL | string, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'cus_new', external_id: WORKSPACE_ID }, 201));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
      }),
    ).resolves.toEqual({ id: 'cus_new' });
    expect(calls).toEqual([
      `GET https://sandbox-api.polar.sh/v1/customers/external/${WORKSPACE_ID}`,
      'POST https://sandbox-api.polar.sh/v1/customers/',
    ]);
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[1]?.body).toBe(
      JSON.stringify({
        external_id: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
      }),
    );
    expect(calls.some((call) => call.includes('/customers/?'))).toBe(false);
  });

  it('refuses a customer whose external id belongs to another workspace', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: 'cus_other', external_id: 'someone-else' })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({ externalId: WORKSPACE_ID, email: 'owner@example.com' }),
    ).rejects.toThrow('Polar customer external_id does not match this workspace');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a customer when lookup fails for a reason other than 404', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({ externalId: WORKSPACE_ID, email: 'owner@example.com' }),
    ).rejects.toThrow('Polar customer lookup failed: 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the external-id customer again when create races', async () => {
    let lookups = 0;
    const fetchMock = vi.fn((_input: URL | string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(new Response('', { status: 422 }));
      lookups += 1;
      if (lookups === 1) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(jsonResponse({ id: 'cus_raced', external_id: WORKSPACE_ID }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({ externalId: WORKSPACE_ID, email: 'owner@example.com' }),
    ).resolves.toEqual({ id: 'cus_raced' });
    expect(fetchMock.mock.calls.map((call) => call[1]?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'GET',
    ]);
    expect(fetchMock.mock.calls.some((call) => requestUrl(call[0]).includes('/customers/?'))).toBe(
      false,
    );
  });

  it('refuses a create response for a different workspace', async () => {
    const fetchMock = vi.fn((_input: URL | string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'cus_other', external_id: 'someone-else' }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({ externalId: WORKSPACE_ID, email: 'owner@example.com' }),
    ).rejects.toThrow('Polar customer external_id does not match this workspace');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
