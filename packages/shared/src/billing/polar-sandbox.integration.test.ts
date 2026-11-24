import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { isMonthlyUsdTeamCheckoutProduct } from '#src/billing/polar-setup.js';

const enabled = process.env.POLAR_SANDBOX_CATALOG_READ === '1';

async function sandboxGet(path: string): Promise<Response> {
  if (process.env.POLAR_SERVER !== 'sandbox' || !process.env.POLAR_ACCESS_TOKEN) {
    throw new Error('A dedicated sandbox token and POLAR_SERVER=sandbox are required');
  }
  return fetch(`https://sandbox-api.polar.sh/v1${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
      Accept: 'application/json',
      'Polar-Version': '2026-10',
    },
    signal: AbortSignal.timeout(15_000),
  });
}

describe.skipIf(!enabled)('Polar sandbox catalog (read only)', () => {
  it('serves the configured monthly USD catalog in the expected organization', async () => {
    const organization = process.env.POLAR_ORGANIZATION_ID;
    const team = process.env.POLAR_PRODUCT_ID_TEAM;
    const enterprise = process.env.POLAR_PRODUCT_ID_ENTERPRISE;
    if (!organization || !team || !enterprise || team === enterprise) {
      throw new Error('Provide the sandbox organization and distinct Team and Enterprise IDs');
    }
    const products = await Promise.all(
      [team, enterprise].map(async (id) => {
        const response = await sandboxGet(`/products/${encodeURIComponent(id)}`);
        expect(response.status).toBe(200);
        return (await response.json()) as {
          organization_id?: string;
          is_archived?: boolean;
          recurring_interval?: string;
          recurring_interval_count?: number;
          prices?: {
            is_archived?: boolean;
            amount_type?: string;
            price_currency?: string;
            tax_behavior?: string;
            meter_id?: string;
            unit_amount?: string | number;
          }[];
        };
      }),
    );
    expect(isMonthlyUsdTeamCheckoutProduct(products[0])).toBe(true);
    for (const product of products) {
      expect(product.organization_id === organization).toBe(true);
      expect(product.is_archived).toBe(false);
      expect(product.recurring_interval).toBe('month');
      expect(product.recurring_interval_count).toBe(1);
      const meters = (product.prices ?? []).filter(
        (price) => price.is_archived === false && price.amount_type === 'metered_unit',
      );
      expect(meters.map((price) => Number(price.unit_amount)).sort()).toEqual([1, 3]);
      expect(
        meters.every(
          (price) => price.price_currency === 'usd' && price.tax_behavior === 'exclusive',
        ),
      ).toBe(true);
      expect(new Set(meters.map((price) => price.meter_id)).size).toBe(2);
    }
    expect(
      products[1]?.prices?.some(
        (price) =>
          price.is_archived === false &&
          price.amount_type === 'custom' &&
          price.price_currency === 'usd' &&
          price.tax_behavior === 'exclusive',
      ),
    ).toBe(true);
  });
});
