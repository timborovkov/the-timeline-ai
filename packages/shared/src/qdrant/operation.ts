import { AsyncLocalStorage } from 'node:async_hooks';

import { childLogger } from '#src/logger.js';

export interface QdrantOperationContext {
  signal?: AbortSignal | undefined;
  /** Absolute wall-clock deadline. Omit to start 30 seconds at the first Qdrant request. */
  deadlineMs?: number | undefined;
}

interface Operation {
  context: QdrantOperationContext;
  category: string;
  startedAt?: number;
  deadlineMs?: number;
  attempts: number;
  retries: number;
  status?: number;
  unavailable?: boolean;
}

const operations = new AsyncLocalStorage<Operation>();
const log = childLogger('qdrant');

export class QdrantUnavailableError extends Error {
  readonly operation: string;
  readonly status: number | undefined;
  readonly outcomeUnknown: boolean;
  constructor(operation: string, status?: number, outcomeUnknown = false) {
    super(
      outcomeUnknown
        ? 'Qdrant operation outcome is unknown.'
        : 'Search is temporarily unavailable. Try again in a moment.',
    );
    this.name = 'QdrantUnavailableError';
    this.operation = operation;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
    const current = operations.getStore();
    if (current) current.unavailable = true;
  }
}

/** Server-only context; no timers or network requests until Qdrant is used. */
export async function withQdrantOperation<T>(
  context: QdrantOperationContext,
  fn: () => Promise<T>,
  category = 'retrieval',
): Promise<T> {
  if (operations.getStore()) return fn();
  const operation: Operation = { context, category, attempts: 0, retries: 0 };
  return operations.run(operation, async () => {
    let outcome = 'success';
    try {
      context.signal?.throwIfAborted();
      return await fn();
    } catch (error) {
      outcome = 'failed';
      if (context.signal?.aborted) outcome = 'cancelled';
      else if (error instanceof QdrantUnavailableError) outcome = 'exhausted';
      throw error;
    } finally {
      if (outcome === 'success' && operation.unavailable) outcome = 'exhausted';
      if (operation.startedAt !== undefined) {
        if (outcome === 'success' && operation.retries > 0) outcome = 'recovered';
        log.info(
          {
            operation: category,
            durationMs: Date.now() - operation.startedAt,
            attempts: operation.attempts,
            status: operation.status,
            outcome,
          },
          'Qdrant recovery',
        );
      }
    }
  });
}

export function currentQdrantOperation(): Operation {
  const operation = operations.getStore();
  if (!operation) throw new Error('Qdrant request requires an operation context');
  if (operation.startedAt === undefined) {
    operation.startedAt = Date.now();
    operation.context.deadlineMs ??= operation.startedAt + 30_000;
    operation.deadlineMs = operation.context.deadlineMs;
  }
  return operation;
}

/** Races work as well as signalling fetch, including response-body reads. */
export async function abortableQdrantWork<T>(
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Qdrant operation cancelled'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, fn()]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
