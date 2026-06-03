import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_BACKUP = { ...process.env };

const fakes = vi.hoisted(() => ({
  reconcile: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/reconcile-jobs', () => ({ reconcileOrphanedJobs: fakes.reconcile }));
vi.mock('@timeline/shared/logger', () => ({
  childLogger: () => ({ error: fakes.loggerError, info: vi.fn(), warn: vi.fn() }),
}));

const { GET, POST } = await import('./route.js');

function request(secret?: string): Request {
  return new Request('https://timeline.test/api/cron/reconcile', {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  resetEnvForTests();
  vi.clearAllMocks();
  fakes.reconcile.mockResolvedValue({ transcribe: 1, extract: 2, embed: 3 });
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('/api/cron/reconcile', () => {
  it('is disabled when CRON_SECRET is unset and forbids bad bearer tokens', async () => {
    delete process.env.CRON_SECRET;
    resetEnvForTests();
    expect((await POST(request('cron-secret'))).status).toBe(503);

    process.env.CRON_SECRET = 'cron-secret';
    resetEnvForTests();
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request('wrong-secret'))).status).toBe(401);
    expect(fakes.reconcile).not.toHaveBeenCalled();
  });

  it('runs the reconciler for POST and GET and returns its counts', async () => {
    const post = await POST(request('cron-secret'));
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toEqual({ ok: true, transcribe: 1, extract: 2, embed: 3 });

    const get = await GET(request('cron-secret'));
    expect(get.status).toBe(200);
    expect(fakes.reconcile).toHaveBeenCalledTimes(2);
  });

  it('maps reconciler failures to a retryable service error', async () => {
    fakes.reconcile.mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await POST(request('cron-secret'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'handler_error' });
    expect(fakes.loggerError).toHaveBeenCalled();
  });
});
