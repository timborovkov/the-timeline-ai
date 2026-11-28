import { AsyncLocalStorage } from 'node:async_hooks';

import type { Db } from '@timeline/db';

import type { BillingMeterId } from '#src/billing/catalog.js';
import { NIL_UUID } from '#src/identifiers.js';

/** Zero UUID used by workers / outbound MCP — cannot match a real member. */
export const BILLING_SYSTEM_USER_ID = NIL_UUID;

export interface BillingAlsContext {
  db: Db;
  teamId: string;
  userId: string;
  operationClass: string;
  source?: string;
  deliverySurface?: string;
  billable?: boolean;
  /** Stable id reused across worker retries of the same job. */
  operationId?: string;
  /** Meters already reserved/settled by the caller (Ask + Recall). */
  skipMeters?: ReadonlySet<BillingMeterId>;
}

const storage = new AsyncLocalStorage<BillingAlsContext>();

export function getBillingContext(): BillingAlsContext | undefined {
  return storage.getStore();
}

export function runWithBillingContext<T>(
  context: BillingAlsContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(context, fn);
}
