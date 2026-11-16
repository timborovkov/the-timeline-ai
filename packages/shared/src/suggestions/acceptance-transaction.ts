import type { Db } from '@timeline/db';

type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type AcceptanceOutcome = 'accepted' | 'superseded' | null;

export interface SuggestionAcceptanceTransaction {
  kind: 'transaction';
  rootDb: Db;
  postCommitEffects: (() => void | Promise<void>)[];
}

export type SuggestionAcceptanceUnitOfWork =
  | SuggestionAcceptanceTransaction
  | { kind: 'root'; run: (itemId: string) => Promise<AcceptanceOutcome> };

interface AcceptanceScope {
  acceptSuggestionItemWithOutcome: (itemId: string) => Promise<AcceptanceOutcome>;
}

/** Evidence locks and canonical writes share one transaction. Queue and cache
 * effects must use the root client, and only after that transaction commits. */
export function createSuggestionAcceptanceUnitOfWork(
  db: Db,
  createScope: (tx: DbTx, context: SuggestionAcceptanceTransaction) => AcceptanceScope,
): SuggestionAcceptanceUnitOfWork {
  return {
    kind: 'root',
    async run(itemId) {
      const context: SuggestionAcceptanceTransaction = {
        kind: 'transaction',
        rootDb: db,
        postCommitEffects: [],
      };
      const outcome = await db.transaction((tx) =>
        createScope(tx, context).acceptSuggestionItemWithOutcome(itemId),
      );
      for (const effect of context.postCommitEffects) await effect();
      return outcome;
    },
  };
}
