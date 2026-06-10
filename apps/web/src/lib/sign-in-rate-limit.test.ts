import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  clientIpFromHeaders: vi.fn(),
  reportHandledEvent: vi.fn(),
}));

vi.mock('@timeline/shared/rate-limit', () => ({
  RATE_LIMITS: {
    signIn: { capacity: 10, refillPerSec: 10 / 60 },
  },
  checkRateLimit: fakes.checkRateLimit,
  rateLimitKey: (...parts: string[]) => parts.join(':'),
}));

vi.mock('@/lib/request-ip', () => ({
  clientIpFromHeaders: fakes.clientIpFromHeaders,
}));

vi.mock('@/lib/sentry-report', () => ({
  reportHandledEvent: fakes.reportHandledEvent,
}));

import { checkCredentialsSignInRateLimit } from '@/lib/sign-in-rate-limit';

describe('checkCredentialsSignInRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.clientIpFromHeaders.mockReturnValue('203.0.113.10');
    fakes.checkRateLimit.mockResolvedValue({ ok: true, remaining: 9, retryAfterMs: 0 });
  });

  it('checks source IP and normalized email buckets', async () => {
    await expect(checkCredentialsSignInRateLimit('user@example.com', new Headers())).resolves.toBe(
      true,
    );

    expect(fakes.checkRateLimit).toHaveBeenNthCalledWith(1, {
      key: 'signin:ip:203.0.113.10',
      capacity: 10,
      refillPerSec: 10 / 60,
    });
    expect(fakes.checkRateLimit).toHaveBeenNthCalledWith(2, {
      key: 'signin:email:user@example.com',
      capacity: 10,
      refillPerSec: 10 / 60,
    });
    expect(fakes.reportHandledEvent).not.toHaveBeenCalled();
  });

  it('blocks before email lookup when the source IP bucket is exhausted', async () => {
    fakes.checkRateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      retryAfterMs: 2500,
    });

    await expect(checkCredentialsSignInRateLimit('user@example.com', new Headers())).resolves.toBe(
      false,
    );

    expect(fakes.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(fakes.reportHandledEvent).toHaveBeenCalledWith({
      message: 'auth_credentials_signin_rate_limited',
      surface: 'api',
      operation: 'credentials_authorize',
      tags: { reason: 'rate_limited', bucket: 'ip' },
    });
  });

  it('blocks when the submitted email bucket is exhausted', async () => {
    fakes.checkRateLimit
      .mockResolvedValueOnce({ ok: true, remaining: 9, retryAfterMs: 0 })
      .mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterMs: 2500 });

    await expect(checkCredentialsSignInRateLimit('user@example.com', new Headers())).resolves.toBe(
      false,
    );

    expect(fakes.checkRateLimit).toHaveBeenCalledTimes(2);
    expect(fakes.reportHandledEvent).toHaveBeenCalledWith({
      message: 'auth_credentials_signin_rate_limited',
      surface: 'api',
      operation: 'credentials_authorize',
      tags: { reason: 'rate_limited', bucket: 'email' },
    });
  });
});
