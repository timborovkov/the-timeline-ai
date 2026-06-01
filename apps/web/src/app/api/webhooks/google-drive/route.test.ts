import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as RateLimitModule from '@timeline/shared/rate-limit';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  integrationRows: [] as { id: string; teamId: string }[],
  enqueueIntegrationSyncJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(fakes.integrationRows)),
        })),
      })),
    })),
  },
}));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn().mockResolvedValue({
    enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
  }),
}));

vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return { ...actual, clientIpFromHeaders: () => null };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const { POST } = await import('./route.js');

function channelToken(integrationId: string, secret = 'drive-secret'): string {
  const sig = createHmac('sha256', secret).update(integrationId).digest('hex');
  return `${integrationId}.${sig}`;
}

beforeEach(() => {
  process.env.GOOGLE_DRIVE_WEBHOOK_SECRET = 'drive-secret';
  resetEnvForTests();
  fakes.integrationRows = [{ id: 'integration-1', teamId: 'team-1' }];
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/google-drive', () => {
  it('rejects missing and badly signed channel tokens', async () => {
    const missing = await POST(new Request('https://timeline.test/api/webhooks/google-drive'));
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toMatchObject({ reason: 'missing_token' });

    const bad = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        headers: { 'x-goog-channel-token': 'integration-1.bad' },
      }),
    );
    expect(bad.status).toBe(200);
    await expect(bad.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.enqueueIntegrationSyncJob).not.toHaveBeenCalled();
  });

  it('enqueues an incremental sync for a valid channel token', async () => {
    const response = await POST(
      new Request('https://timeline.test/api/webhooks/google-drive', {
        method: 'POST',
        headers: { 'x-goog-channel-token': channelToken('integration-1') },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith({
      kind: 'incremental',
      integrationId: 'integration-1',
      teamId: 'team-1',
      triggeredBy: 'webhook',
    });
  });
});
