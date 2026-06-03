import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailModule from '@timeline/shared/email';
import type * as RateLimitModule from '@timeline/shared/rate-limit';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  handleInbound: vi.fn(),
  queue: {
    enqueueExtractJob: vi.fn(),
    enqueueEmbedJob: vi.fn(),
    enqueueSuggestionJob: vi.fn(),
    enqueueTranscribeJob: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: vi.fn(() => Promise.resolve(fakes.queue)),
}));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/email', async () => {
  const actual = await vi.importActual<typeof EmailModule>('@timeline/shared/email');
  return {
    ...actual,
    clientIpFromHeaders: () => null,
    handleInbound: fakes.handleInbound,
  };
});

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
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
  fakes.queue.enqueueExtractJob.mockResolvedValue(undefined);
  fakes.queue.enqueueEmbedJob.mockResolvedValue(undefined);
  fakes.queue.enqueueSuggestionJob.mockResolvedValue(undefined);
  fakes.queue.enqueueTranscribeJob.mockResolvedValue(undefined);
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

  it('passes Redis-backed extract, embed, and suggestion queues to the dispatcher', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    resetEnvForTests();
    fakes.handleInbound.mockImplementationOnce(async (deps: EmailModule.DispatcherDeps) => {
      await deps.extract?.enqueueExtract({ rawEventId: 'raw-1', teamId: 'team-1' });
      await deps.embed?.enqueueEmbed({ rawEventId: 'raw-1', teamId: 'team-1' });
      await deps.suggestions?.enqueueSuggestion({ rawEventId: 'raw-1', teamId: 'team-1' });
      return { ok: true, inserted: 1 };
    });

    const response = await POST(inboundRequest());

    expect(response.status).toBe(200);
    expect(fakes.queue.enqueueExtractJob).toHaveBeenCalledWith({
      rawEventId: 'raw-1',
      teamId: 'team-1',
    });
    expect(fakes.queue.enqueueEmbedJob).toHaveBeenCalledWith({
      rawEventId: 'raw-1',
      teamId: 'team-1',
    });
    expect(fakes.queue.enqueueSuggestionJob).toHaveBeenCalledWith({
      rawEventId: 'raw-1',
      teamId: 'team-1',
    });
  });

  it('keeps attachment deps separate from Redis text queues', async () => {
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'timeline';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_BUCKET_ATTACHMENTS = 'attachments';
    process.env.S3_BUCKET_AUDIO = 'audio';
    delete process.env.REDIS_URL;
    resetEnvForTests();
    fakes.handleInbound.mockImplementationOnce((deps: EmailModule.DispatcherDeps) => {
      expect(deps.attachments).toBeDefined();
      expect(deps.extract).toBeUndefined();
      expect(deps.embed).toBeUndefined();
      expect(deps.suggestions).toBeUndefined();
      return Promise.resolve({ ok: true, inserted: 1 });
    });

    const response = await POST(inboundRequest());

    expect(response.status).toBe(200);
    expect(fakes.handleInbound).toHaveBeenCalledOnce();
  });
});
