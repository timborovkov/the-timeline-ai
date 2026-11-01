import { createHmac } from 'node:crypto';

import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

const enqueueEmailInboundJob = vi.fn().mockResolvedValue(undefined);
await vi.mock(
  import.meta.resolve('@/lib/queue'),
  () => ({ requireRedisQueue: () => Promise.resolve({ enqueueEmailInboundJob }) }),
  () => import('@/lib/queue'),
);
const { resetEnvForTests } = await import('@timeline/shared/env');
const { POST } = await import('@/app/api/email/inbound/route');
const backup = { ...process.env };
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`;
const emailId = '11111111-1111-4111-8111-111111111111';
function request(
  event: unknown = { type: 'email.received', data: { email_id: emailId } },
  secondsAgo = 0,
  tamper = false,
  rawBody?: string,
): Request {
  const body = rawBody ?? JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000) - secondsAgo);
  const signature = createHmac('sha256', Buffer.alloc(32, 7))
    .update(`evt_1.${timestamp}.${body}`)
    .digest('base64');
  return new Request('https://timeline.test/api/email/inbound', {
    method: 'POST',
    body: tamper ? `${body} ` : body,
    headers: {
      'svix-id': 'evt_1',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
  });
}
beforeEach(() => {
  Object.assign(process.env, {
    RESEND_API_KEY: 're_test',
    RESEND_WEBHOOK_SECRET: secret,
    INBOUND_EMAIL_DOMAIN: 'inbound.test',
    REDIS_URL: 'redis://localhost:6379',
  });
  resetEnvForTests();
  enqueueEmailInboundJob.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  process.env = { ...backup };
  resetEnvForTests();
});
describe('Resend inbound webhook', () => {
  it('queues only the received email id, including repeated deliveries', async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(enqueueEmailInboundJob).toHaveBeenCalledWith({ emailId });
  });
  it('rejects tampered and stale signed bodies before queueing', async () => {
    expect((await POST(request(undefined, 0, true))).status).toBe(401);
    expect((await POST(request(undefined, 600))).status).toBe(401);
    expect(enqueueEmailInboundJob).not.toHaveBeenCalled();
  });
  it('ignores unrelated authenticated events and rejects malformed received events', async () => {
    expect((await POST(request({ type: 'email.sent', data: {} }))).status).toBe(200);
    expect((await POST(request(undefined, 0, false, '{'))).status).toBe(400);
    expect(
      (await POST(request({ type: 'email.received', data: { email_id: 'invalid' } }))).status,
    ).toBe(400);
    expect(enqueueEmailInboundJob).not.toHaveBeenCalled();
  });
  it('does not acknowledge unavailable queues or configuration', async () => {
    enqueueEmailInboundJob.mockRejectedValueOnce(new Error('redis down'));
    expect((await POST(request())).status).toBe(503);
    delete process.env.RESEND_API_KEY;
    resetEnvForTests();
    expect((await POST(request())).status).toBe(503);
  });
});
