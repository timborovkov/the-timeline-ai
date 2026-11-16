import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve(undefined)),
}));

await vi.mock(
  import.meta.resolve('next-auth/react'),
  () => ({
    signOut: fakes.signOut,
  }),
  () => import('next-auth/react'),
);

const { signOutAfterClearingLocalSession } = await import('@/lib/sign-out-session');

describe('signOutAfterClearingLocalSession', () => {
  beforeEach(() => {
    fakes.signOut.mockReset();
    fakes.signOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still signs out when localStorage throws', async () => {
    const assign = vi.fn();
    const storage = {
      get length() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      key() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      getItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      removeItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      clear() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    } as unknown as Storage;

    await expect(signOutAfterClearingLocalSession(storage, assign)).resolves.toBeUndefined();
    expect(fakes.signOut).toHaveBeenCalledWith({ redirect: false, redirectTo: '/sign-in' });
    expect(assign).toHaveBeenCalledWith('/sign-in');
  });
  it('preserves an invitation through sign-out without following an external callback', async () => {
    const assign = vi.fn();
    await signOutAfterClearingLocalSession(
      window.localStorage,
      assign,
      '/accept-invite/example-token',
    );
    expect(assign).toHaveBeenCalledWith('/sign-in?callbackUrl=%2Faccept-invite%2Fexample-token');
    for (const callback of [
      'https://attacker.example/path',
      '//attacker.example',
      '/sign-in',
      '/sign-up',
    ]) {
      assign.mockClear();
      await signOutAfterClearingLocalSession(window.localStorage, assign, callback);
      expect(assign).toHaveBeenCalledWith('/sign-in');
    }
  });

  it('does not navigate when sign-out fails', async () => {
    const assign = vi.fn();
    fakes.signOut.mockRejectedValueOnce(new Error('offline'));
    await expect(signOutAfterClearingLocalSession(window.localStorage, assign)).rejects.toThrow(
      'offline',
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
