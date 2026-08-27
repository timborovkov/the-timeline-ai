import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runSentryServerAction } from '@/lib/sentry-action';

type ServerActionInstrumentation = (
  operation: string,
  options: { headers: Headers | Promise<Headers> },
  callback: () => unknown,
) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  headers: vi.fn<() => Headers>(),
  redirect: vi.fn(),
  withServerActionInstrumentation: vi.fn<ServerActionInstrumentation>(
    (_operation, _options, callback) => Promise.resolve(callback()),
  ),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));

vi.mock('@/lib/auth.config', () => ({
  hasCurrentLegalSession: (user: {
    legalTermsVersion?: string | null;
    legalPrivacyVersion?: string | null;
    legalAcceptedAt?: string | null;
  }) =>
    user.legalTermsVersion === '2026-08-21' &&
    user.legalPrivacyVersion === '2026-08-21' &&
    Boolean(user.legalAcceptedAt),
}));

vi.mock('next/headers', () => ({
  headers: mocks.headers,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@sentry/nextjs', () => ({
  withServerActionInstrumentation: mocks.withServerActionInstrumentation,
}));

describe('runSentryServerAction', () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.headers.mockReturnValue(
      new Headers({
        'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
      }),
    );
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    mocks.withServerActionInstrumentation.mockClear();
  });

  it('passes only a valid trace header into Sentry instrumentation', async () => {
    mocks.headers.mockReturnValue(
      new Headers({
        'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
        referer: 'https://timeline.test/accept-invite/secret?token=private',
        'x-forwarded-for': '203.0.113.10',
        'x-private-secret': 'must-not-reach-sentry',
      }),
    );
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
    const sentryHeaders = await call[1].headers;
    expect(Object.fromEntries(sentryHeaders)).toEqual({
      'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
    });
    expect(typeof call[2]).toBe('function');
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('drops malformed trace headers instead of forwarding arbitrary text', async () => {
    mocks.headers.mockReturnValue(
      new Headers({ 'sentry-trace': 'person@example.test-private-project' }),
    );

    await runSentryServerAction('accept_legal', () => 'ok');

    const call = mocks.withServerActionInstrumentation.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(Object.fromEntries(await call[1].headers)).toEqual({});
  });

  it('runs protected actions for a current legal session', async () => {
    mocks.headers.mockReturnValue(new Headers({ 'next-action': 'action-id' }));
    mocks.auth.mockResolvedValue({
      user: {
        legalTermsVersion: '2026-08-21',
        legalPrivacyVersion: '2026-08-21',
        legalAcceptedAt: '2026-08-21T00:00:00.000Z',
      },
    });

    await expect(runSentryServerAction('create_team', () => 'ok')).resolves.toBe('ok');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('redirects a stale authenticated action before its callback runs', async () => {
    mocks.headers.mockReturnValue(new Headers({ 'next-action': 'action-id' }));
    const callback = vi.fn(() => 'should not run');
    mocks.auth.mockResolvedValue({
      user: {
        legalTermsVersion: 'old',
        legalPrivacyVersion: 'old',
        legalAcceptedAt: '2026-06-02T00:00:00.000Z',
      },
    });

    await expect(runSentryServerAction('create_team', callback)).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/legal/accept?returnTo=%2Fapp');
    expect(callback).not.toHaveBeenCalled();
  });

  it('leaves the invite return target to the token-aware invite action', async () => {
    mocks.headers.mockReturnValue(new Headers({ 'next-action': 'action-id' }));
    const callback = vi.fn(() => 'invite action result');

    await expect(runSentryServerAction('accept_invite', callback)).resolves.toBe(
      'invite action result',
    );
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('leaves unauthenticated rejection to the action itself', async () => {
    mocks.headers.mockReturnValue(new Headers({ 'next-action': 'action-id' }));
    mocks.auth.mockResolvedValue(null);

    await expect(runSentryServerAction('create_team', () => 'action result')).resolves.toBe(
      'action result',
    );
  });

  it('keeps every server-action module on the shared legal and tracing boundary', () => {
    const actionsDirectory = join(process.cwd(), 'src/app/actions');
    const serverActionFiles = readdirSync(actionsDirectory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) =>
        readFileSync(join(actionsDirectory, file), 'utf8').includes("'use server'"),
      );

    expect(serverActionFiles.length).toBeGreaterThan(0);
    for (const file of serverActionFiles) {
      expect(readFileSync(join(actionsDirectory, file), 'utf8'), file).toContain(
        'runSentryServerAction',
      );
    }
  });
});
