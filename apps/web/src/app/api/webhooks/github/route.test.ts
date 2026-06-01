import { createHmac } from 'node:crypto';

import { resetEnvForTests } from '@timeline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModuleNS from '@timeline/shared';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  selectionRows: [] as { integrationId: string }[],
  integrationRows: [] as { id: string; teamId: string }[],
  handleWebhook: vi.fn(),
  writeIntegrationEvents: vi.fn(),
  enqueueIntegrationSyncJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn((shape?: unknown) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(shape ? fakes.selectionRows : fakes.integrationRows)),
      })),
    })),
  },
}));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModuleNS>('@timeline/shared');
  return {
    ...actual,
    email: { ...actual.email, clientIpFromHeaders: () => null },
    rateLimit: {
      ...actual.rateLimit,
      checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    },
    integrations: {
      ...actual.integrations,
      getProvider: () => ({ handleWebhook: fakes.handleWebhook }),
      writeIntegrationEvents: fakes.writeIntegrationEvents,
    },
    queue: {
      ...actual.queue,
      enqueueIntegrationSyncJob: fakes.enqueueIntegrationSyncJob,
    },
  };
});

const { POST } = await import('./route.js');

function signedRequest(payload: unknown, signature = true): Request {
  const body = JSON.stringify(payload);
  const digest = createHmac('sha256', 'github-secret').update(body).digest('hex');
  return new Request('https://timeline.test/api/webhooks/github', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature ? `sha256=${digest}` : 'sha256=bad',
    },
    body,
  });
}

beforeEach(() => {
  process.env.GITHUB_WEBHOOK_SECRET = 'github-secret';
  resetEnvForTests();
  fakes.selectionRows = [{ integrationId: 'integration-1' }];
  fakes.integrationRows = [{ id: 'integration-1', teamId: 'team-1' }];
  fakes.handleWebhook.mockResolvedValue([{ dedupKey: 'event-1' }]);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/webhooks/github', () => {
  it('rejects bad signatures before routing', async () => {
    const response = await POST(signedRequest({ repository: { full_name: 'acme/app' } }, false));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reason: 'bad_signature' });
    expect(fakes.handleWebhook).not.toHaveBeenCalled();
  });

  it('routes selected repository webhooks to the matched integration', async () => {
    const response = await POST(signedRequest({ repository: { full_name: 'acme/app' } }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.handleWebhook).toHaveBeenCalledWith({
      integration: { id: 'integration-1', teamId: 'team-1' },
      payload: { repository: { full_name: 'acme/app' } },
    });
    expect(fakes.writeIntegrationEvents).toHaveBeenCalled();
    expect(fakes.enqueueIntegrationSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'integration-1', triggeredBy: 'webhook' }),
    );
  });
});
