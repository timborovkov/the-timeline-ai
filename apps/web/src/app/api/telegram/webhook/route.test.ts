import { resetEnvForTests } from '@timeline/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SharedModuleNS from '@timeline/shared';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: {} }));

vi.mock('@timeline/shared', async () => {
  const actual = await vi.importActual<typeof SharedModuleNS>('@timeline/shared');
  return {
    ...actual,
    childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    rateLimit: {
      ...actual.rateLimit,
      checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
    },
    telegram: {
      ...actual.telegram,
      handleUpdate: fakes.handleUpdate,
    },
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
});
