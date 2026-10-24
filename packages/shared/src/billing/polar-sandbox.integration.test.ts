import { describe, expect, it } from 'vitest';

/**
 * Opt-in Polar sandbox checks. Skipped unless POLAR_SANDBOX_INTEGRATION=1,
 * POLAR_SERVER=sandbox, and the access token plus the three subscription
 * product ids, including Enterprise, are set. Never confirms payment and never ingests usage.
 */
const ARCHIVED_TOPUP_PRODUCT_ID = '203852a1-263f-4c8a-9925-e86fa23236da';
const FAKE_EXTERNAL_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000e2';

const sandboxReady =
  process.env.POLAR_SANDBOX_INTEGRATION === '1' &&
  process.env.POLAR_SERVER === 'sandbox' &&
  Boolean(process.env.POLAR_ACCESS_TOKEN) &&
  Boolean(process.env.POLAR_PRODUCT_ID_PAYG) &&
  Boolean(process.env.POLAR_PRODUCT_ID_TEAM) &&
  Boolean(process.env.POLAR_PRODUCT_ID_BUSINESS) &&
  Boolean(process.env.POLAR_PRODUCT_ID_ENTERPRISE);

async function polar(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) throw new Error('POLAR_ACCESS_TOKEN is required');
  return fetch(`https://sandbox-api.polar.sh/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'curl/8.5.0',
    },
  });
}

describe.skipIf(!sandboxReady)('Polar sandbox subscription billing', () => {
  it('serves the Timeline subscription products and an archived top-up', async () => {
    const products = [
      ['payg', process.env.POLAR_PRODUCT_ID_PAYG],
      ['team', process.env.POLAR_PRODUCT_ID_TEAM],
      ['business', process.env.POLAR_PRODUCT_ID_BUSINESS],
      ['enterprise', process.env.POLAR_PRODUCT_ID_ENTERPRISE],
    ] as const;
    for (const [plan, id] of products) {
      const res = await polar(`/products/${id}`);
      expect(res.status, plan).toBe(200);
      const body = (await res.json()) as {
        is_archived?: boolean;
        name?: string;
        prices?: {
          unit_amount?: string | number | null;
          amount_type?: string;
        }[];
      };
      expect(body.is_archived, plan).not.toBe(true);
      expect(body.name ?? '').toMatch(/^Timeline /u);
      const prices = body.prices ?? [];
      const extraMember = prices.find((price) => Number(price.unit_amount) === 200);
      expect(extraMember, plan).toBeTruthy();
      if (plan === 'enterprise') {
        expect(prices.some((price) => price.amount_type === 'custom')).toBe(true);
        expect(
          prices.filter((price) => price.amount_type === 'metered_unit').length,
        ).toBeGreaterThanOrEqual(6);
      }
    }

    const archived = await polar(`/products/${ARCHIVED_TOPUP_PRODUCT_ID}`);
    expect(archived.status).toBe(200);
    const topup = (await archived.json()) as { is_archived?: boolean; name?: string };
    expect(topup.name).toBe('Timeline Top-up');
    expect(topup.is_archived).toBe(true);
  });

  it('opens a PAYG checkout and leaves it unpaid', async () => {
    const res = await polar('/checkouts/', {
      method: 'POST',
      body: JSON.stringify({
        products: [process.env.POLAR_PRODUCT_ID_PAYG],
        success_url: 'https://thetimeline.cc/app/team?section=billing',
        customer_email: 'owner@timeline.dev',
        customer_external_id: FAKE_EXTERNAL_CUSTOMER_ID,
      }),
    });
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { url?: string; status?: string };
    expect(body.url ?? '').toContain('sandbox.polar.sh');
    expect(body.status ?? 'open').not.toBe('succeeded');
  });
});
