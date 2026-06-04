import * as Sentry from '@sentry/nextjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_BACKUP = { ...process.env };

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  flush: vi.fn(),
  getClient: vi.fn(),
}));

const { POST } = await import('./route.js');

function request(token?: string): Request {
  return new Request('https://timeline.test/api/sentry/smoke', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  process.env.SENTRY_SMOKE_TEST_TOKEN = 'smoke-secret';
  process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
  vi.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>);
  vi.mocked(Sentry.flush).mockResolvedValue(true);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('/api/sentry/smoke', () => {
  it('is disabled unless the smoke token is configured', async () => {
    delete process.env.SENTRY_SMOKE_TEST_TOKEN;

    const response = await POST(request('smoke-secret'));

    expect(response.status).toBe(404);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('requires the bearer token', async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request('wrong-secret'))).status).toBe(401);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports whether the deployed runtime is missing a Sentry DSN', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    const response = await POST(request('smoke-secret'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, sentryConfigured: false });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports whether the Sentry SDK client was never initialized', async () => {
    vi.mocked(Sentry.getClient).mockReturnValue(undefined);

    const response = await POST(request('smoke-secret'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      sentryConfigured: true,
      clientInitialized: false,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures and flushes a synthetic Sentry error', async () => {
    const response = await POST(request('smoke-secret'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sentryConfigured: true,
      clientInitialized: true,
      flushed: true,
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: 'error',
      tags: {
        surface: 'api',
        operation: 'sentry_smoke_test',
        component: 'web',
      },
    });
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });
});
