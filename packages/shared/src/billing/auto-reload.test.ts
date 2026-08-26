import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { maybeTriggerWalletAutoReload } from '#src/billing/auto-reload.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
import { applyDbMigrations } from '#src/test/pglite.js';

vi.mock('#src/billing/polar.js', () => ({
  polarTopUpProductId: () => 'prod_topup',
  createPolarBillingProvider: () => null,
}));

vi.mock('#src/messaging/delivery.js', () => ({
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  vi.clearAllMocks();
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'auto-reload', 'Auto Reload');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  await pg.close();
});

const account = {
  autoReloadEnabled: true,
  autoReloadThresholdCents: 500,
  autoReloadAmountCents: 1000,
  walletBalanceCents: 0,
  reservedBalanceCents: 0,
  spendCapCents: 2500,
  shadowBilling: false,
  polarCustomerId: 'cus_test',
  planId: 'payg',
};

describe('maybeTriggerWalletAutoReload', () => {
  it('retries after Polar checkout fails', async () => {
    const provider = createFakeBillingProvider();
    provider.createCheckoutSession = () => Promise.reject(new Error('polar down'));
    const first = await maybeTriggerWalletAutoReload({
      db,
      teamId: TEAM_ID,
      account,
      meteredSpendCents: 0,
      provider,
    });
    expect(first).toEqual({ triggered: false, reason: 'checkout_failed' });

    provider.createCheckoutSession = () =>
      Promise.resolve({
        id: 'chk_retry',
        url: 'https://sandbox.polar.sh/checkout/retry',
      });
    const second = await maybeTriggerWalletAutoReload({
      db,
      teamId: TEAM_ID,
      account,
      meteredSpendCents: 0,
      provider,
    });
    expect(second).toEqual({ triggered: true });
  });
});
