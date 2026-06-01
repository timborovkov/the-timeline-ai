import { resetEnvForTests } from '@timeline/shared/env';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { turnstileHostnameFromHeaders, verifyTurnstileToken } from '@/lib/turnstile';

const ENV_BACKUP = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  process.env = {
    ...ENV_BACKUP,
    AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
    DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
    ...overrides,
  };
  resetEnvForTests();
}

function mockSiteverifyResponse(body: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
  vi.unstubAllGlobals();
});

describe('verifyTurnstileToken', () => {
  it('fails open without a secret outside production', async () => {
    setEnv({ NODE_ENV: 'development', TURNSTILE_SECRET_KEY: undefined });

    await expect(verifyTurnstileToken({ token: null })).resolves.toBe(true);
  });

  it('fails closed without a secret in production', async () => {
    setEnv({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: undefined });

    await expect(verifyTurnstileToken({ token: 'token' })).resolves.toBe(false);
  });

  it('posts the token, secret, remote IP, and idempotency key to Cloudflare', async () => {
    setEnv({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'secret' });
    const fetchMock = mockSiteverifyResponse({
      success: true,
      action: 'signup',
      hostname: 'app.example.com',
    });

    await expect(
      verifyTurnstileToken({
        token: 'token',
        remoteIp: '203.0.113.10',
        expectedAction: 'signup',
        expectedHostname: 'app.example.com',
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe('token');
    expect(body.get('remoteip')).toBe('203.0.113.10');
    expect(body.get('idempotency_key')).toEqual(expect.any(String));
  });

  it('rejects action and hostname mismatches even when siteverify succeeds', async () => {
    setEnv({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'secret' });
    mockSiteverifyResponse({
      success: true,
      action: 'support',
      hostname: 'evil.example',
    });

    await expect(
      verifyTurnstileToken({
        token: 'token',
        expectedAction: 'signup',
        expectedHostname: 'app.example.com',
      }),
    ).resolves.toBe(false);
  });

  it('rejects empty and oversized tokens before calling Cloudflare', async () => {
    setEnv({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'secret' });
    const fetchMock = mockSiteverifyResponse({ success: true });

    await expect(verifyTurnstileToken({ token: '' })).resolves.toBe(false);
    await expect(verifyTurnstileToken({ token: 'x'.repeat(2049) })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('turnstileHostnameFromHeaders', () => {
  it('normalizes forwarded hosts for Cloudflare hostname comparison', () => {
    const headers = new Headers({
      'x-forwarded-host': 'app.example.com:443, internal:3000',
      host: 'fallback.example.com',
    });

    expect(turnstileHostnameFromHeaders(headers)).toBe('app.example.com');
  });
});
