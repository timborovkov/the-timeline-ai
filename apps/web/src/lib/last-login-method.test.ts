import { expect, vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const jar = { get: vi.fn(), set: vi.fn() };
await vi.mock(
  import.meta.resolve('next/headers'),
  () => ({ cookies: () => Promise.resolve(jar) }),
  () => import('next/headers'),
);
const { readLastLoginMethod, rememberLastLoginMethod } = await import('./last-login-method');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('last successful login method', () => {
  it('ignores missing or unrecognized cookies', async () => {
    for (const value of [undefined, '', 'unknown', 'Google']) {
      jar.get.mockReturnValue(value === undefined ? undefined : { value });
      expect(await readLastLoginMethod()).toBeNull();
    }
  });

  it('remembers supported methods without storing an account identity', async () => {
    for (const method of ['google', 'github', 'credentials']) {
      await rememberLastLoginMethod(method);
      expect(jar.set).toHaveBeenLastCalledWith('tl_last_login_method', method, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 15_552_000,
      });
      jar.get.mockReturnValue({ value: method });
      expect(await readLastLoginMethod()).toBe(method);
    }
  });

  it('does not replace the preference for unsupported providers', async () => {
    await rememberLastLoginMethod(undefined);
    await rememberLastLoginMethod('unknown');
    expect(jar.set).not.toHaveBeenCalled();
  });
});
