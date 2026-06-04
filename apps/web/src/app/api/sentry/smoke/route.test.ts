import * as Sentry from '@sentry/nextjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_BACKUP = { ...process.env };

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  flush: vi.fn(),
  getClient: vi.fn(),
}));

const { POST } = await import('./route.js');

beforeEach(() => {
  process.env.SENTRY_DSN = 'https://example@sentry.invalid/1';
  vi.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>);
  vi.mocked(Sentry.flush).mockResolvedValue(true);
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('/api/sentry/smoke', () => {
  it('reports whether the deployed runtime is missing a Sentry DSN', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, sentryConfigured: false });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports whether the Sentry SDK client was never initialized', async () => {
    vi.mocked(Sentry.getClient).mockReturnValue(undefined);

    const response = await POST();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      sentryConfigured: true,
      clientInitialized: false,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures and flushes a synthetic Sentry error', async () => {
    const response = await POST();

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
