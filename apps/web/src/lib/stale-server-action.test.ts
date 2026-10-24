// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isStaleServerActionError,
  recoverFromStaleServerAction,
  reloadForStaleServerAction,
  resetStaleServerActionReloadGuardForTests,
} from '@/lib/stale-server-action';

afterEach(() => {
  resetStaleServerActionReloadGuardForTests();
  vi.restoreAllMocks();
});

describe('isStaleServerActionError', () => {
  it('detects UnrecognizedActionError by name', () => {
    const error = new Error('Server Action "abc" was not found on the server.');
    error.name = 'UnrecognizedActionError';
    expect(isStaleServerActionError(error)).toBe(true);
  });

  it('detects the Next.js stale-action message without the error name', () => {
    expect(
      isStaleServerActionError(
        new Error(
          'Server Action "408e336cb54bf606304291ef6c2da057f97d0fc0b2" was not found on the server.',
        ),
      ),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isStaleServerActionError(new Error('route failed'))).toBe(false);
    expect(isStaleServerActionError(null)).toBe(false);
  });
});

describe('recoverFromStaleServerAction', () => {
  it('reloads once per tab session for stale server actions', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload: reload });

    const error = new Error('Server Action "abc" was not found on the server.');
    error.name = 'UnrecognizedActionError';

    expect(recoverFromStaleServerAction(error)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(recoverFromStaleServerAction(error)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload for unrelated errors', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload: reload });

    expect(recoverFromStaleServerAction(new Error('route failed'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('reloadForStaleServerAction', () => {
  it('reloads the page', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload: reload });

    reloadForStaleServerAction();
    expect(reload).toHaveBeenCalledOnce();
  });
});
