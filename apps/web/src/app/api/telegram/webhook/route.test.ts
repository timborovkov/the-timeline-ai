import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RateLimitModule from '@timeline/shared/rate-limit';
import type * as TelegramModule from '@timeline/shared/telegram';

const ENV_BACKUP = { ...process.env };

interface TelegramDispatcherDeps {
  extract?: { enqueueExtract(input: { rawEventId: string; teamId: string }): Promise<void> };
  embed?: { enqueueEmbed(input: { rawEventId: string; teamId: string }): Promise<void> };
  suggestions?: {
    enqueueSuggestion(input: { rawEventId: string; teamId: string }): Promise<void>;
  };
}

const fakes = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
  requireRedisQueue: vi.fn(),
  enqueueExtractJob: vi.fn(),
  enqueueEmbedJob: vi.fn(),
  enqueueSuggestionJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/queue', () => ({
  requireRedisQueue: fakes.requireRedisQueue,
}));

vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('@timeline/shared/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@timeline/shared/rate-limit');
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
  };
});

vi.mock('@timeline/shared/telegram', async () => {
  const actual = await vi.importActual<typeof TelegramModule>('@timeline/shared/telegram');
  return {
    ...actual,
    handleUpdate: fakes.handleUpdate,
  };
});

const { POST } = await import('./route.js');

function telegramRequest(secret = 'telegram-secret'): Request {
  return new Request('https://timeline.test/api/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ update_id: 1, message: { from: { id: 42 }, text: 'hi' } }),
  });
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-secret';
  resetEnvForTests();
  fakes.handleUpdate.mockResolvedValue(undefined);
  fakes.requireRedisQueue.mockResolvedValue({
    enqueueExtractJob: fakes.enqueueExtractJob,
    enqueueEmbedJob: fakes.enqueueEmbedJob,
    enqueueSuggestionJob: fakes.enqueueSuggestionJob,
  });
  fakes.enqueueExtractJob.mockResolvedValue(undefined);
  fakes.enqueueEmbedJob.mockResolvedValue(undefined);
  fakes.enqueueSuggestionJob.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('POST /api/telegram/webhook', () => {
  it('returns 503 when disabled and 401 when the secret header is wrong', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    resetEnvForTests();
    expect((await POST(telegramRequest())).status).toBe(503);

    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-secret';
    resetEnvForTests();
    expect((await POST(telegramRequest('wrong'))).status).toBe(401);
    expect(fakes.handleUpdate).not.toHaveBeenCalled();
  });

  it('routes valid Telegram updates to the dispatcher', async () => {
    const response = await POST(telegramRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(fakes.handleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ db: {} }),
      expect.objectContaining({ update_id: 1 }),
    );
  });

  it('passes extract, embed, and suggestion queues to the dispatcher when Redis is configured', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    resetEnvForTests();
    fakes.handleUpdate.mockImplementation(async (deps: TelegramDispatcherDeps) => {
      await deps.extract?.enqueueExtract({ rawEventId: 'raw-1', teamId: 'team-1' });
      await deps.embed?.enqueueEmbed({ rawEventId: 'raw-1', teamId: 'team-1' });
      await deps.suggestions?.enqueueSuggestion({ rawEventId: 'raw-1', teamId: 'team-1' });
    });

    const response = await POST(telegramRequest());

    expect(response.status).toBe(200);
    expect(fakes.enqueueExtractJob).toHaveBeenCalledWith({ rawEventId: 'raw-1', teamId: 'team-1' });
    expect(fakes.enqueueEmbedJob).toHaveBeenCalledWith({ rawEventId: 'raw-1', teamId: 'team-1' });
    expect(fakes.enqueueSuggestionJob).toHaveBeenCalledWith({
      rawEventId: 'raw-1',
      teamId: 'team-1',
    });
  });
});
