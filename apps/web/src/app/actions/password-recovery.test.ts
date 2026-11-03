import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

import type * as RateLimitModule from '@timeline/shared/rate-limit';

const limit = vi.fn();
const request = vi.fn();
const reset = vi.fn();
const report = vi.fn();
await vi.mock(
  import.meta.resolve('@timeline/shared/rate-limit'),
  async (original) => ({
    ...(await original<typeof RateLimitModule>()),
    checkRateLimit: limit,
  }),
  () => import('@timeline/shared/rate-limit'),
);
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '192.0.2.1' })) }),
  () => import('next/headers'),
);
await vi.mock(
  import.meta.resolve('@/lib/password-recovery'),
  () => ({ requestPasswordRecovery: request, resetRecoveredPassword: reset }),
  () => import('@/lib/password-recovery'),
);
await vi.mock(
  import.meta.resolve('@/lib/sentry-report'),
  () => ({ reportHandledEvent: report }),
  () => import('@/lib/sentry-report'),
);
const { requestPasswordResetAction, resetPasswordAction } =
  await import('@/app/actions/password-recovery');

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const token = 'a'.repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  limit.mockReset().mockResolvedValue({ ok: true });
  request.mockReset().mockResolvedValue(undefined);
  reset.mockReset().mockResolvedValue('reset');
});

describe('recovery actions', () => {
  it('normalizes email and uses generic confirmation even on account-specific failure', async () => {
    expect(await requestPasswordResetAction({}, form({ email: 'PERSON@example.test' }))).toEqual({
      ok: true,
    });
    expect(request.mock.calls[0]?.[1]).toBe('person@example.test');
    request.mockRejectedValue(new Error(`private email/token ${token}`));
    expect(await requestPasswordResetAction({}, form({ email: 'person@example.test' }))).toEqual({
      ok: true,
    });
    expect(JSON.stringify(report.mock.calls)).not.toContain(token);
  });
  it('rejects malformed email before accessing the account', async () => {
    expect(await requestPasswordResetAction({}, form({ email: 'bad' }))).toHaveProperty('error');
    expect(request).not.toHaveBeenCalled();
  });
  it('suppresses email-limited requests generically and reports IP throttling', async () => {
    limit.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    expect(await requestPasswordResetAction({}, form({ email: 'person@example.test' }))).toEqual({
      ok: true,
    });
    expect(request).not.toHaveBeenCalled();
    limit.mockResolvedValueOnce({ ok: false });
    expect(
      await requestPasswordResetAction({}, form({ email: 'person@example.test' })),
    ).toHaveProperty('error');
    expect(request).not.toHaveBeenCalled();
  });
  it('validates confirmation and both password bounds', async () => {
    for (const [password, confirmation] of [
      ['short', 'short'],
      ['a'.repeat(201), 'a'.repeat(201)],
      ['valid-password', 'different-password'],
    ] as const) {
      expect(await resetPasswordAction({}, form({ token, password, confirmation }))).toHaveProperty(
        'error',
      );
    }
    expect(reset).not.toHaveBeenCalled();
  });
  it('returns success, expired and replay states and prevents throttled redemption', async () => {
    const data = form({ token, password: 'valid-password', confirmation: 'valid-password' });
    expect(await resetPasswordAction({}, data)).toEqual({ ok: true });
    reset.mockResolvedValueOnce('expired');
    expect(await resetPasswordAction({}, data)).toMatchObject({
      invalidToken: true,
      error: 'This reset link has expired.',
    });
    reset.mockResolvedValueOnce('invalid');
    expect(await resetPasswordAction({}, data)).toMatchObject({ invalidToken: true });
    limit.mockResolvedValueOnce({ ok: false });
    expect(await resetPasswordAction({}, data)).toHaveProperty('error');
    expect(reset).toHaveBeenCalledTimes(3);
  });
  it('returns a retryable message for infrastructure errors without exposing secrets', async () => {
    reset.mockRejectedValue(new Error(token));
    const result = await resetPasswordAction(
      {},
      form({ token, password: 'valid-password', confirmation: 'valid-password' }),
    );
    expect(result).toHaveProperty('error');
    expect(JSON.stringify([result, report.mock.calls])).not.toContain(token);
  });
});
