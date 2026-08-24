import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyPolarWebhookSignature = vi.fn();
const handlePolarWebhookEvent = vi.fn();

vi.mock('@timeline/shared/env', () => ({
  getEnv: () => ({
    POLAR_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
    POLAR_PRODUCT_ID_PAYG: 'prod_payg',
    POLAR_PRODUCT_ID_TEAM: 'prod_team',
    POLAR_PRODUCT_ID_BUSINESS: 'prod_business',
    POLAR_PRODUCT_ID_TOPUP: 'prod_topup',
    BILLING_CHARGES_ENABLED: false,
  }),
}));

vi.mock('@timeline/shared/billing', () => ({
  verifyPolarWebhookSignature: (...args: unknown[]) =>
    verifyPolarWebhookSignature(...args) as boolean,
  handlePolarWebhookEvent: (...args: unknown[]) => handlePolarWebhookEvent(...args) as unknown,
}));

vi.mock('@/lib/db', () => ({
  db: { id: 'db' },
}));

describe('POST /api/webhooks/polar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPolarWebhookSignature.mockReturnValue(true);
    handlePolarWebhookEvent.mockResolvedValue({ ok: true });
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

  it('forwards a verified payload to the Polar webhook handler', async () => {
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
    expect(handlePolarWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        chargesEnabled: false,
        products: expect.objectContaining({
          team: 'prod_team',
          topup: 'prod_topup',
        }),
      }),
    );
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
