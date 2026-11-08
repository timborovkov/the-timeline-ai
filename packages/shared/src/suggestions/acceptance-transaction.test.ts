import { describe, expect, it } from 'bun:test';

import { createSuggestionAcceptanceUnitOfWork } from '#src/suggestions/acceptance-transaction.js';

import type { Db } from '@timeline/db';

// Approval effects must not escape a rollback or run while their writes are uncommitted.
describe('suggestion acceptance unit of work', () => {
  it('delivers effects after commit with the root client and preserves the outcome', async () => {
    const events: string[] = [];
    const tx = {};
    const db = {
      async transaction(run: (tx: unknown) => Promise<unknown>) {
        const outcome = await run(tx);
        events.push('committed');
        return outcome;
      },
    } as unknown as Db;
    const acceptance = createSuggestionAcceptanceUnitOfWork(db, (client, context) => ({
      acceptSuggestionItemWithOutcome(itemId) {
        expect(Object.is(client, tx)).toBe(true);
        expect(context.rootDb).toBe(db);
        expect(itemId).toBe('item');
        context.postCommitEffects.push(() => {
          events.push('delivered');
          return Promise.resolve();
        });
        return Promise.resolve('accepted' as const);
      },
    }));
    if (acceptance.kind !== 'root') throw new Error('Expected root acceptance');
    expect(await acceptance.run('item')).toBe('accepted');
    expect(events).toEqual(['committed', 'delivered']);
  });

  it('discards effects when the transaction cannot commit', async () => {
    let delivered = false;
    const failure = new Error('commit rejected');
    const db = {
      async transaction(run: (tx: unknown) => Promise<unknown>) {
        await run({});
        throw failure;
      },
    } as unknown as Db;
    const acceptance = createSuggestionAcceptanceUnitOfWork(db, (_client, context) => ({
      acceptSuggestionItemWithOutcome() {
        context.postCommitEffects.push(() => {
          delivered = true;
        });
        return Promise.resolve('accepted' as const);
      },
    }));
    if (acceptance.kind !== 'root') throw new Error('Expected root acceptance');
    expect(await acceptance.run('item').catch((error: unknown) => error)).toBe(failure);
    expect(delivered).toBe(false);
  });

  it('does not carry deferred effects into a later acceptance', async () => {
    const delivered: string[] = [];
    const failure = new Error('apply rejected');
    const db = {
      transaction: (run: (tx: unknown) => Promise<unknown>) => run({}),
    } as unknown as Db;
    const acceptance = createSuggestionAcceptanceUnitOfWork(db, (_client, context) => ({
      acceptSuggestionItemWithOutcome(itemId) {
        context.postCommitEffects.push(() => {
          delivered.push(itemId);
        });
        if (itemId === 'failed') return Promise.reject(failure);
        return Promise.resolve('superseded' as const);
      },
    }));
    if (acceptance.kind !== 'root') throw new Error('Expected root acceptance');
    expect(await acceptance.run('failed').catch((error: unknown) => error)).toBe(failure);
    expect(await acceptance.run('later')).toBe('superseded');
    expect(delivered).toEqual(['later']);
  });
});
