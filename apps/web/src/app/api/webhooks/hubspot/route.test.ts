import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

const record =
  vi.fn<(_db: unknown, portal: string, key: string) => Promise<{ deliveryId: string | null }>>();
const enqueue = vi.fn().mockResolvedValue(undefined);
await vi.mock(
  import.meta.resolve('@timeline/shared/integrations'),
  async () => ({ ...(await import('@timeline/shared/integrations')), recordHubspotWakeup: record }),
  () => import('@timeline/shared/integrations'),
);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({ requireRedisQueue: () => Promise.resolve({ enqueueWebhookDeliveryJob: enqueue }) }),
  () => import('@/lib/queue'),
);
const { POST } = await import('./route.js');
const backup = { ...process.env };
const origin = 'https://timeline.test';
const endpoint = origin + '/api/webhooks/hubspot';
const secret = 'synthetic-hubspot-app-secret';
function request(body: string, signed = true) {
  const stamp = String(Date.now());
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'x-hubspot-request-timestamp': stamp,
      'x-hubspot-signature-v3': signed
        ? createHmac('sha256', secret)
            .update('POST' + endpoint + body + stamp)
            .digest('base64')
        : 'invalid',
    },
    body,
  });
}
describe('HubSpot webhook delivery', () => {
  beforeEach(() => {
    process.env.AUTH_URL = origin;
    process.env.HUBSPOT_CLIENT_SECRET = secret;
    resetEnvForTests();
    record.mockReset();
    enqueue.mockClear();
  });
  afterEach(() => {
    process.env = { ...backup };
    resetEnvForTests();
  });
  it('authenticates before accessing the database and rejects malformed signed batches', async () => {
    expect((await POST(request('[]', false))).status).toBe(401);
    expect((await POST(request('{'))).status).toBe(400);
    expect((await POST(request('[{}]'))).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
  it('enqueues each known portal independently without forwarding property values', async () => {
    record.mockImplementation((_db, portal) =>
      Promise.resolve({ deliveryId: portal === '17' ? 'matched' : null }),
    );
    const event = {
      portalId: 17,
      eventId: 99,
      objectId: 43,
      occurredAt: 12345,
      subscriptionType: 'object.propertyChange',
      objectTypeId: '0-3',
      propertyName: 'dealstage',
      propertyValue: 'fixture-stage',
    };
    expect(
      (await POST(request(JSON.stringify([event, event, { ...event, portalId: 21 }])))).status,
    ).toBe(200);
    expect(record.mock.calls.map(([, portal]) => portal).sort()).toEqual(['17', '21']);
    expect(record.mock.calls.every(([, , key]) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(enqueue.mock.calls).toEqual([[{ deliveryId: 'matched' }]]);
  });
});
