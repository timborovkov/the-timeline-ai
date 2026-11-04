import {
  abortableQdrantWork,
  currentQdrantOperation,
  QdrantUnavailableError,
} from '#src/qdrant/operation.js';

export type QdrantRequestKind = 'read' | 'initialization' | 'write' | 'snapshot';

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  // Bun http::Error::name() and older fetch mappings: plain Error, not TypeError.
  'ConnectionRefused',
  'ConnectionReset',
  'ConnectionClosed',
  'ConnectionTimedOut',
  'FailedToOpenSocket',
  'HostNotFound',
  'HostUnreachable',
  'NetworkUnreachable',
  'Timeout',
]);

function networkErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const coded = current as { code?: unknown; cause?: unknown };
    if (typeof coded.code === 'string' && TRANSIENT_NETWORK_CODES.has(coded.code))
      return coded.code;
    current = coded.cause;
  }
  return undefined;
}

export function isTransientQdrantNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  if (networkErrorCode(error)) return true;
  return /fetch failed|failed to fetch|network|connect|socket/i.test(error.message);
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

export async function qdrantRequest(input: {
  fetcher: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;
  url: string;
  headers: Record<string, string>;
  method: string;
  kind: QdrantRequestKind;
  body?: unknown;
  text?: boolean;
}): Promise<{ status: number; data: unknown }> {
  const operation = currentQdrantOperation();
  const { signal } = operation.context;
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  let retry = 0;
  for (;;) {
    signal?.throwIfAborted();
    const remaining = (operation.deadlineMs ?? Date.now()) - Date.now();
    if (input.kind === 'read' && remaining <= 0) {
      throw new QdrantUnavailableError(operation.category, operation.status);
    }
    // Initialization belongs to the read budget; mutations keep their own execution budget.
    let timeoutMs = input.kind === 'snapshot' ? 600_000 : 120_000;
    if (input.kind === 'read' || input.kind === 'initialization')
      timeoutMs = Math.min(10_000, remaining);
    if (timeoutMs <= 0) throw new QdrantUnavailableError(operation.category, operation.status);
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new DOMException('Qdrant request timed out', 'TimeoutError'));
    }, timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    let pause: number | undefined;
    operation.attempts++;
    delete operation.status;
    try {
      const result = await abortableQdrantWork(attemptSignal, async () => {
        const response = await input.fetcher(input.url, {
          method: input.method,
          headers: input.headers,
          ...(body === undefined ? {} : { body }),
          signal: attemptSignal,
        });
        operation.status = response.status;
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (retryable) {
          await response.body?.cancel();
          return {
            retryable: true as const,
            status: response.status,
            pause: [429, 503].includes(response.status)
              ? retryAfterMs(response.headers.get('retry-after'))
              : undefined,
          };
        }
        if (!response.ok && response.status !== 404) {
          await response.body?.cancel();
          throw Object.assign(
            new Error(`Qdrant ${input.kind} failed: ${String(response.status)}`),
            { status: response.status },
          );
        }
        const text = await response.text();
        // Invalid successful responses are permanent errors, never empty search results.
        let data: unknown = null;
        if (input.text) data = text;
        else if (response.status !== 404) {
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error('Invalid Qdrant JSON response');
          }
          if (!data || typeof data !== 'object' || !('result' in data))
            throw new Error('Invalid Qdrant response envelope');
        }
        return { retryable: false as const, status: response.status, data };
      });
      if (!result.retryable) {
        // Writes have a separate execution budget. Verification gets a fresh read budget.
        if (input.kind === 'write' || input.kind === 'snapshot')
          operation.deadlineMs = Date.now() + 30_000;
        return { status: result.status, data: result.data };
      }
      if (input.kind !== 'read')
        throw new QdrantUnavailableError(operation.category, result.status, true);
      pause = result.pause;
    } catch (error) {
      signal?.throwIfAborted();
      if (!isTransientQdrantNetworkError(error)) throw error;
      if (input.kind !== 'read')
        throw new QdrantUnavailableError(operation.category, operation.status, true);
    } finally {
      clearTimeout(timer);
    }
    pause = Math.max(
      pause ?? 0,
      Math.min(4000, 500 * 2 ** Math.min(retry++, 4)) * (0.5 + Math.random() * 0.5),
    );
    const left = (operation.deadlineMs ?? Date.now()) - Date.now();
    if (pause >= left) throw new QdrantUnavailableError(operation.category, operation.status);
    operation.retries++;
    let backoffTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await abortableQdrantWork(
        signal ?? new AbortController().signal,
        () =>
          new Promise<void>((resolve) => {
            backoffTimer = setTimeout(resolve, pause);
          }),
      );
    } finally {
      clearTimeout(backoffTimer);
    }
  }
}
