import { resetEnvForTests } from '@timeline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModuleNS from '@timeline/shared';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  handleInbound: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModuleNS>('@timeline/shared');
  return {
    ...actual,
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    email: {
      ...actual.email,
      clientIpFromHeaders: () => null,
      handleInbound: fakes.handleInbound,
    },
    rateLimit: {
      ...actual.rateLimit,
      checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});

const { POST } = await import('./route.js');

function auth(secret = 'postmark-secret'): string {
  return `Basic ${Buffer.from(`postmark:${secret}`).toString('base64')}`;
}

function inboundRequest(secret = 'postmark-secret'): Request {
  return new Request('https://timeline.test/api/email/inbound', {
    method: 'POST',
    headers: { authorization: auth(secret), 'content-type': 'application/json' },
    body: JSON.stringify({
      FromFull: { Email: 'ada@example.com' },
      ToFull: [{ Email: 'team@inbound.test' }],
      TextBody: 'Launch note',
    }),
  });
}

beforeEach(() => {
  process.env.POSTMARK_WEBHOOK_SECRET = 'postmark-secret';
  process.env.INBOUND_EMAIL_DOMAIN = 'inbound.test';
  resetEnvForTests();
  fakes.handleInbound.mockResolvedValue({ ok: true, inserted: 1 });
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/email/inbound', () => {
  it('returns 503 when disabled and 401 for invalid Basic auth', async () => {
    delete process.env.POSTMARK_WEBHOOK_SECRET;
    resetEnvForTests();
    expect((await POST(inboundRequest())).status).toBe(503);

    process.env.POSTMARK_WEBHOOK_SECRET = 'postmark-secret';
    resetEnvForTests();
    expect((await POST(inboundRequest('wrong'))).status).toBe(401);
    expect(fakes.handleInbound).not.toHaveBeenCalled();
  });

  it('routes authenticated Postmark payloads to the inbound email dispatcher', async () => {
    const response = await POST(inboundRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, inserted: 1 });
    expect(fakes.handleInbound).toHaveBeenCalledWith(
      expect.objectContaining({ db: {}, inboundDomain: 'inbound.test' }),
      expect.objectContaining({ TextBody: 'Launch note' }),
    );
  });
});
