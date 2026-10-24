// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('next-auth/react', () => ({
  signOut: fakes.signOut,
}));

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
});
