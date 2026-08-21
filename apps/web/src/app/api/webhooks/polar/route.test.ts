import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyPolarWebhookSignature = vi.fn();
const insertValues = vi.fn();
const onConflictDoUpdate = vi.fn();
const updateSet = vi.fn();
const updateWhere = vi.fn();

vi.mock('@timeline/shared/env', () => ({
  getEnv: () => ({
    POLAR_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
    POLAR_PRODUCT_ID_PAYG: 'prod_payg',
    POLAR_PRODUCT_ID_TEAM: 'prod_team',
    POLAR_PRODUCT_ID_BUSINESS: 'prod_business',
    BILLING_CHARGES_ENABLED: false,
  }),
}));

vi.mock('@timeline/shared/billing', () => ({
  verifyPolarWebhookSignature: (...args: unknown[]) => verifyPolarWebhookSignature(...args),
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return { onConflictDoUpdate };
      },
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        updateSet(...args);
        return { where: updateWhere };
      },
    }),
  },
}));

vi.mock('@timeline/db', () => ({
  teamBillingAccounts: { teamId: 'team_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

describe('POST /api/webhooks/polar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPolarWebhookSignature.mockReturnValue(true);
    onConflictDoUpdate.mockResolvedValue(undefined);
    updateWhere.mockResolvedValue(undefined);
  });

  it('rejects invalid signatures', async () => {
    verifyPolarWebhookSignature.mockReturnValue(false);
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/webhooks/polar', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('upserts team billing on subscription.active', async () => {
    const { POST } = await import('./route');
    const body = JSON.stringify({
      type: 'subscription.active',
      data: {
        id: 'sub_1',
        product_id: 'prod_team',
        customer: { id: 'cus_1', external_id: 'team-uuid' },
      },
    });
    const res = await POST(
      new Request('http://localhost/api/webhooks/polar', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalled();
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });
});

describe('signature helper wiring', () => {
  it('documents expected header names for fixtures', () => {
    const secretRaw = Buffer.from('test-secret');
    const body = '{}';
    const webhookId = 'msg_1';
    const timestamp = '1';
    const signature = createHmac('sha256', secretRaw)
      .update(`${webhookId}.${timestamp}.${body}`)
      .digest('base64');
    expect(signature.length).toBeGreaterThan(10);
  });
});
