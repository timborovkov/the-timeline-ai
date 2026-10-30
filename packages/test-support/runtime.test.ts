import { describe, it } from 'bun:test';

import { expect, freshModuleUrl, vi } from './index.js';
describe('Bun test contract', () => {
  it('assimilates database-style thenables for resolves and rejects', async () => {
    const query = {
      then: (resolve: (rows: string[]) => unknown) => Promise.resolve(resolve(['row'])),
    };
    await expect(query).resolves.toEqual(['row']);
    const failed = {
      then: (_resolve: unknown, reject: (error: Error) => unknown) =>
        reject(new Error('query failed')),
    };
    await expect(failed).rejects.toThrow('query failed');
  });

  it('preserves static asymmetric matchers', () => {
    expect({ x: 1 }).toEqual(expect.not.objectContaining({ x: 2 }));
    expect(['prefix:123']).toEqual(
      expect.arrayContaining([expect.stringMatching('^prefix:[0-9]+$')]),
    );
  });

  it('does not mutate nested arrays during subset assertions', async () => {
    const retryAt = new Date();
    const value = { continuations: [{ resourceType: 'repo', retryAt }] };
    expect(value).toMatchObject({
      continuations: [expect.objectContaining({ resourceType: 'repo' })],
    });
    expect(value.continuations[0]?.retryAt).toBe(retryAt);
    await expect(Promise.resolve(value)).resolves.toMatchObject({
      continuations: [expect.objectContaining({ resourceType: 'repo' })],
    });
    expect(value.continuations[0]?.retryAt).toBe(retryAt);
    expect(() => {
      expect(value).toMatchObject({ continuations: [{ resourceType: 'wrong' }] });
    }).toThrow();
  });

  it('uses distinct absolute import specifiers after a module reset', () => {
    const first = freshModuleUrl(import.meta.url);
    vi.resetModules();
    expect(freshModuleUrl(import.meta.url)).not.toBe(first);
    expect(first.startsWith('file:')).toBe(false);
  });

  it('advances asynchronous timers and restores real timers', async () => {
    vi.useFakeTimers();
    try {
      const called = vi.fn();
      setTimeout(() => {
        void Promise.resolve().then(called);
      }, 25);
      await vi.advanceTimersByTimeAsync(25);
      expect(called).toHaveBeenCalledOnce();
      const now = Date.now();
      vi.clearAllTimers();
      expect(Date.now()).toBe(now);
      setTimeout(called, 25);
      await vi.waitFor(() => {
        expect(called).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
