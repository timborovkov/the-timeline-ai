import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import {
  createPolarBillingProvider,
  createPlanChangeSession,
  PolarDiscountError,
  polarCustomerByExternalIdPath,
  polarCustomerIdForExternalId,
} from '#src/billing/polar.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('expireCheckout', () => {
  it('treats a missing or finished checkout as expired and a paid one as already paid', async () => {
    const provider = createPolarBillingProvider({
      accessToken: 'polar-test',
      server: 'sandbox',
      organizationId: 'org-synthetic',
    });
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
    const provider = createPolarBillingProvider({
      accessToken: 'polar-test',
      server: 'sandbox',
      organizationId: 'org-synthetic',
    });
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
  const provider = createPolarBillingProvider({
    accessToken: 'polar-test',
    server: 'sandbox',
    organizationId: 'org-synthetic',
  });
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
      return Promise.resolve(
        jsonResponse({
          id: 'cus_workspace',
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { email: 'owner@example.com', userId: 'owner-id' },
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
        return Promise.resolve(
          jsonResponse(
            {
              id: 'cus_new',
              external_id: WORKSPACE_ID,
              organization_id: 'org-synthetic',
              type: 'team',
            },
            201,
          ),
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { email: 'owner@example.com', userId: 'owner-id' },
      }),
    ).resolves.toEqual({ id: 'cus_new' });
    expect(calls).toEqual([
      `GET https://sandbox-api.polar.sh/v1/customers/external/${WORKSPACE_ID}`,
      'POST https://sandbox-api.polar.sh/v1/customers/',
    ]);
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[1]?.body).toBe(
      JSON.stringify({
        type: 'team',
        external_id: WORKSPACE_ID,
        organization_id: 'org-synthetic',
        name: 'Workspace',
        owner: { email: 'owner@example.com', external_id: 'owner-id' },
      }),
    );
    expect(calls.some((call) => call.includes('/customers/?'))).toBe(false);
  });

  it('refuses a customer whose external id belongs to another workspace', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          id: 'cus_other',
          external_id: 'someone-else',
          organization_id: 'org-synthetic',
          type: 'team',
        }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { userId: 'owner-id', email: 'owner@example.com' },
      }),
    ).rejects.toThrow('billing identity needs operator review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a customer when lookup fails for a reason other than 404', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { userId: 'owner-id', email: 'owner@example.com' },
      }),
    ).rejects.toThrow('temporarily unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the external-id customer again when create races', async () => {
    let lookups = 0;
    const fetchMock = vi.fn((_input: URL | string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(new Response('', { status: 422 }));
      lookups += 1;
      if (lookups === 1) return Promise.resolve(new Response('', { status: 404 }));
      return Promise.resolve(
        jsonResponse({
          id: 'cus_raced',
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        }),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { userId: 'owner-id', email: 'owner@example.com' },
      }),
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
        return Promise.resolve(
          jsonResponse({
            id: 'cus_other',
            external_id: 'someone-else',
            organization_id: 'org-synthetic',
            type: 'team',
          }),
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      polarProvider().ensureCustomer({
        externalId: WORKSPACE_ID,
        email: 'owner@example.com',
        name: 'Workspace',
        owner: { userId: 'owner-id', email: 'owner@example.com' },
      }),
    ).rejects.toThrow('billing identity needs operator review');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

const discountFixture = {
  id: 'discount-synthetic',
  organization_id: 'org-synthetic',
  code: 'SYNTHETIC',
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  redemptions_count: 0,
  products: [{ id: 'product-synthetic' }],
};
const checkoutInput = {
  customerId: 'cus-synthetic',
  externalCustomerId: WORKSPACE_ID,
  customerEmail: 'synthetic@example.test',
  productId: 'product-synthetic',
  successUrl: 'https://timeline.test/success',
};
function discountProvider(server: 'sandbox' | 'production' = 'sandbox') {
  const provider = createPolarBillingProvider({
    accessToken: 'synthetic-token',
    server,
    organizationId: 'org-synthetic',
  });
  if (!provider) throw new Error('provider');
  return provider;
}
function catalog(items: unknown[]) {
  return jsonResponse({ items, pagination: { max_page: 1 } });
}

describe('Polar managed checkout discounts', () => {
  it('resolves case-insensitive codes across pages in the configured organization and environment', async () => {
    for (const server of ['sandbox', 'production'] as const) {
      const calls: string[] = [];
      globalThis.fetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push(url.toString());
        expect(url.origin).toBe(
          server === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh',
        );
        expect(url.searchParams.get('organization_id')).toBe('org-synthetic');
        expect(url.searchParams.has('query')).toBe(false);
        expect(new Headers(init?.headers).get('Polar-Version')).toBe('2026-10');
        return jsonResponse({
          items: url.searchParams.get('page') === '2' ? [discountFixture] : [],
          pagination: { max_page: 2 },
        });
      }) as unknown as typeof fetch;
      expect(
        await discountProvider(server).resolveDiscount({
          code: ' synthetic ',
          productId: checkoutInput.productId,
        }),
      ).toBe(discountFixture.id);
      expect(calls).toHaveLength(2);
    }
  });

  it('rejects unknown codes, foreign organizations, product restrictions, dates and exhausted limits', async () => {
    for (const items of [
      [],
      [{ ...discountFixture, code: 'OTHER' }],
      [{ ...discountFixture, organization_id: 'foreign-org' }],
      [{ ...discountFixture, products: [{ id: 'other-product' }] }],
      [{ ...discountFixture, starts_at: '2999-01-01T00:00:00Z' }],
      [{ ...discountFixture, ends_at: '2000-01-01T00:00:00Z' }],
      [{ ...discountFixture, max_redemptions: 1, redemptions_count: 1 }],
    ]) {
      globalThis.fetch = vi.fn(async () => catalog(items)) as unknown as typeof fetch;
      await expect(
        discountProvider().resolveDiscount({
          code: 'SYNTHETIC',
          productId: checkoutInput.productId,
        }),
      ).rejects.toMatchObject({ code: 'ineligible' });
    }
  });

  it('permits unrestricted products and validates trusted assignments against the same organization', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ ...discountFixture, products: [] }),
    ) as unknown as typeof fetch;
    expect(
      await discountProvider().resolveDiscount({
        discountId: discountFixture.id,
        productId: 'another-product',
      }),
    ).toBe(discountFixture.id);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ ...discountFixture, organization_id: 'other-org' }),
    ) as unknown as typeof fetch;
    await expect(
      discountProvider().resolveDiscount({
        discountId: discountFixture.id,
        productId: checkoutInput.productId,
      }),
    ).rejects.toMatchObject({ code: 'ineligible' });
  });

  it('distinguishes outages, permissions, rate limits and malformed responses from ineligible codes', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response('', { status })),
      ) as unknown as typeof fetch;
      await expect(
        discountProvider().resolveDiscount({
          code: 'SYNTHETIC',
          productId: checkoutInput.productId,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
    for (const body of [
      {},
      { items: [{ ...discountFixture, ends_at: 'bad-date' }], pagination: { max_page: 1 } },
    ]) {
      globalThis.fetch = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
      await expect(
        discountProvider().resolveDiscount({
          code: 'SYNTHETIC',
          productId: checkoutInput.productId,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    }
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error('network failure')),
    ) as unknown as typeof fetch;
    await expect(
      discountProvider().resolveDiscount({ code: 'SYNTHETIC', productId: checkoutInput.productId }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('requires organization configuration without making a request', async () => {
    const fetchMock = vi.fn(async () => catalog([discountFixture]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = createPolarBillingProvider({
      accessToken: 'synthetic',
      server: 'sandbox',
      organizationId: '',
    });
    if (!provider) throw new Error('provider');
    await expect(
      provider.resolveDiscount({ code: 'SYNTHETIC', productId: checkoutInput.productId }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates checkout with verified discount and correct customer identity, disabling code replacement', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      expect(
        JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
      ).toEqual({
        products: [checkoutInput.productId],
        success_url: checkoutInput.successUrl,
        customer_id: checkoutInput.customerId,
        allow_discount_codes: false,
        discount_id: discountFixture.id,
      });
      return jsonResponse({
        id: 'checkout-synthetic',
        url: 'https://checkout.test',
        discount_id: discountFixture.id,
      });
    });
    globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
      if (String(url).includes('/customers/'))
        return jsonResponse({
          id: checkoutInput.customerId,
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        });
      if (String(url).includes('/subscriptions/') && init?.method === 'GET')
        return jsonResponse({ customer_id: checkoutInput.customerId });
      return (fetchMock as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    expect(
      await discountProvider().createCheckoutSession({
        ...checkoutInput,
        discountId: discountFixture.id,
      }),
    ).toEqual({ id: 'checkout-synthetic', url: 'https://checkout.test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not need discount configuration or catalog access for no-code checkout', async () => {
    const fetchMock = vi.fn(async (_url: URL | string, init?: RequestInit) => {
      expect(
        (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>)
          .discount_id,
      ).toBeUndefined();
      return jsonResponse({ id: 'checkout-synthetic', url: 'https://checkout.test' });
    });
    globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
      if (String(url).includes('/customers/'))
        return jsonResponse({
          id: checkoutInput.customerId,
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        });
      if (String(url).includes('/subscriptions/') && init?.method === 'GET')
        return jsonResponse({ customer_id: checkoutInput.customerId });
      return (fetchMock as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    await expect(polarProvider().createCheckoutSession(checkoutInput)).resolves.toMatchObject({
      id: 'checkout-synthetic',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses missing discounts in successful responses and propagates final Polar eligibility rejection', async () => {
    for (const [body, status, code] of [
      [{ id: 'checkout', url: 'https://checkout.test', discount_id: null }, 200, 'unavailable'],
      [
        { detail: [{ loc: ['body', 'discount_id'], msg: 'Customer redemption limit reached' }] },
        422,
        'ineligible',
      ],
      [{ detail: [{ loc: ['body', 'products'], msg: 'invalid product' }] }, 422, 'unavailable'],
      [{}, 503, 'unavailable'],
    ] as const) {
      const fetchMock = vi.fn(async () => jsonResponse(body, status));
      globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
        if (String(url).includes('/customers/'))
          return jsonResponse({
            id: checkoutInput.customerId,
            external_id: WORKSPACE_ID,
            organization_id: 'org-synthetic',
            type: 'team',
          });
        if (String(url).includes('/subscriptions/') && init?.method === 'GET')
          return jsonResponse({ customer_id: checkoutInput.customerId });
        return (fetchMock as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;
      await expect(
        discountProvider().createCheckoutSession({
          ...checkoutInput,
          discountId: discountFixture.id,
        }),
      ).rejects.toMatchObject({ code });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('verifies the discount on a successful paid-plan update', async () => {
    const fetchMock = vi.fn((_url: URL | string, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toEqual({
        product_id: checkoutInput.productId,
        proration_behavior: 'prorate',
        discount_id: discountFixture.id,
      });
      return jsonResponse({ discount_id: discountFixture.id });
    });
    globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
      if (String(url).includes('/customers/'))
        return jsonResponse({
          id: checkoutInput.customerId,
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        });
      if (String(url).includes('/subscriptions/') && init?.method === 'GET')
        return jsonResponse({ customer_id: checkoutInput.customerId });
      return (fetchMock as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    await expect(
      createPlanChangeSession({
        ...checkoutInput,
        provider: discountProvider(),
        discountId: discountFixture.id,
        account: {
          planId: 'team',
          billingState: 'team_active',
          polarSubscriptionId: 'subscription-synthetic',
        },
        portalReturnUrl: 'https://timeline.test/return',
      }),
    ).resolves.toEqual({ url: checkoutInput.successUrl });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a discounted plan change on outage, omitted discount, or transport failure', async () => {
    for (const response of [
      () => jsonResponse({}, 503),
      () => jsonResponse({ discount_id: null }),
      () => Promise.reject(new Error('connection lost')),
    ]) {
      const fetchMock = vi.fn(response);
      globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
        if (String(url).includes('/customers/'))
          return jsonResponse({
            id: checkoutInput.customerId,
            external_id: WORKSPACE_ID,
            organization_id: 'org-synthetic',
            type: 'team',
          });
        if (String(url).includes('/subscriptions/') && init?.method === 'GET')
          return jsonResponse({ customer_id: checkoutInput.customerId });
        return (fetchMock as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;
      await expect(
        createPlanChangeSession({
          ...checkoutInput,
          provider: discountProvider(),
          discountId: discountFixture.id,
          account: {
            planId: 'team',
            billingState: 'team_active',
            polarSubscriptionId: 'subscription-synthetic',
          },
          portalReturnUrl: 'https://timeline.test/return',
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('never falls back to a full-price portal or second checkout when a discounted subscription update fails', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ detail: [{ loc: ['body', 'discount_id'] }] }, 422),
    );
    globalThis.fetch = ((url: URL | string, init?: RequestInit) => {
      if (String(url).includes('/customers/'))
        return jsonResponse({
          id: checkoutInput.customerId,
          external_id: WORKSPACE_ID,
          organization_id: 'org-synthetic',
          type: 'team',
        });
      if (String(url).includes('/subscriptions/') && init?.method === 'GET')
        return jsonResponse({ customer_id: checkoutInput.customerId });
      return (fetchMock as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    await expect(
      createPlanChangeSession({
        ...checkoutInput,
        provider: discountProvider(),
        discountId: discountFixture.id,
        account: {
          planId: 'team',
          billingState: 'team_active',
          polarSubscriptionId: 'subscription-synthetic',
        },
        portalReturnUrl: 'https://timeline.test/return',
      }),
    ).rejects.toBeInstanceOf(PolarDiscountError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
