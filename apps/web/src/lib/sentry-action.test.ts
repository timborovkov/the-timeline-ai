import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSentryServerAction } from '@/lib/sentry-action';

type ServerActionInstrumentation = (
  operation: string,
  options: { headers: Headers | Promise<Headers> },
  callback: () => unknown,
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  headers: vi.fn<() => Headers>(),
  withServerActionInstrumentation: vi.fn<ServerActionInstrumentation>(
    (_operation, _options, callback) => Promise.resolve(callback()),
  ),
}));

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}));

vi.mock('@sentry/nextjs', () => ({
  withServerActionInstrumentation: mocks.withServerActionInstrumentation,
}));

describe('runSentryServerAction', () => {
  beforeEach(() => {
    mocks.headers.mockReturnValue(new Headers({ 'sentry-trace': 'trace' }));
    mocks.withServerActionInstrumentation.mockClear();
  });

  it('runs server actions through Sentry with request headers for trace continuity', async () => {
    await expect(
      runSentryServerAction('accept_legal', async () => {
        await Promise.resolve();
        return 'ok';
      }),
    ).resolves.toBe('ok');

    const call = mocks.withServerActionInstrumentation.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call[0]).toBe('accept_legal');
    await expect(call[1].headers).resolves.toBeInstanceOf(Headers);
    expect(typeof call[2]).toBe('function');
  });
});
