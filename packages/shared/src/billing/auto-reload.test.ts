import { PGlite } from '@electric-sql/pglite';
import { billingUsageLedger, type Db } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { maybeTriggerWalletAutoReload } from '#src/billing/auto-reload.js';
import { createFakeBillingProvider } from '#src/billing/provider.js';
import { sendMessage } from '#src/messaging/delivery.js';
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

  it('retries owner notification after Polar checkout succeeds but delivery fails', async () => {
    const provider = createFakeBillingProvider();
    provider.createCheckoutSession = () =>
      Promise.resolve({
        id: 'chk_notify',
        url: 'https://sandbox.polar.sh/checkout/notify',
      });
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error: 'postmark down' });
    const first = await maybeTriggerWalletAutoReload({
      db,
      teamId: TEAM_ID,
      account,
      meteredSpendCents: 0,
      provider,
    });
    expect(first).toEqual({ triggered: true });
    const [row] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(row?.metadata).toMatchObject({
      auto_reload_status: 'checkout_created',
      checkout_url: 'https://sandbox.polar.sh/checkout/notify',
    });

    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true });
    const createCheckout = vi.fn().mockResolvedValue({
      id: 'chk_notify',
      url: 'https://sandbox.polar.sh/checkout/notify',
    });
    provider.createCheckoutSession = createCheckout;
    const second = await maybeTriggerWalletAutoReload({
      db,
      teamId: TEAM_ID,
      account,
      meteredSpendCents: 0,
      provider,
    });
    expect(second).toEqual({ triggered: true });
    expect(createCheckout).not.toHaveBeenCalled();
    const [sent] = await db
      .select()
      .from(billingUsageLedger)
      .where(eq(billingUsageLedger.teamId, TEAM_ID));
    expect(sent?.metadata).toMatchObject({ auto_reload_status: 'sent' });
  });

  it('skips auto-reload when the spend cap is a hard stop at 0', async () => {
    const result = await maybeTriggerWalletAutoReload({
      db,
      teamId: TEAM_ID,
      account: { ...account, spendCapCents: 0 },
      meteredSpendCents: 0,
      provider: createFakeBillingProvider(),
    });
    expect(result).toEqual({ triggered: false, reason: 'spend_cap' });
  });
});
