import { lookup as dnsLookup } from 'node:dns/promises';

import { Agent, fetch as undiciFetch } from 'undici/index.js';

import type { LookupAddress, LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';

import { formatErrorCause } from '#src/http/error-cause.js';
import { validateMcpUrl, validatePublicIpAddress } from '#src/mcp/auth.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export type ExternalHttpErrorCode =
  | 'aborted'
  | 'blocked_address'
  | 'dns_failure'
  | 'invalid_url'
  | 'network_failure'
  | 'response_too_large'
  | 'timeout';

export class ExternalHttpError extends Error {
  constructor(
    readonly code: ExternalHttpErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    const causeText =
      options?.cause === undefined ? '' : ` [cause: ${formatErrorCause(options.cause)}]`;
    super(`${message} code=${code}${causeText}`, options);
    this.name = 'ExternalHttpError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

type ExternalLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ExternalFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  lookup?: ExternalLookup;
  /** Local integration tests and development-only localhost MCP servers. */
  allowPrivateNetworkInDevelopment?: boolean;
}

function allowPrivateNetwork(options: ExternalFetchOptions): boolean {
  return options.allowPrivateNetworkInDevelopment === true && process.env.NODE_ENV !== 'production';
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await dnsLookup(hostname, { all: true, order: 'verbatim' });
  return rows.flatMap((row) =>
    row.family === 4 || row.family === 6 ? [{ address: row.address, family: row.family }] : [],
  );
}

export async function resolveExternalAddresses(
  hostname: string,
  options: Pick<ExternalFetchOptions, 'allowPrivateNetworkInDevelopment' | 'lookup'> = {},
): Promise<ResolvedAddress[]> {
  const normalized =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  let addresses: ResolvedAddress[];
  try {
    const directError = validatePublicIpAddress(normalized);
    if (directError !== 'Invalid IP address') {
      addresses = [
        {
          address: normalized,
          family: normalized.includes(':') ? 6 : 4,
        },
      ];
    } else {
      addresses = await (options.lookup ?? defaultLookup)(normalized);
    }
  } catch (cause) {
    throw new ExternalHttpError('dns_failure', `DNS lookup failed for ${normalized}`, { cause });
  }
  if (addresses.length === 0) {
    throw new ExternalHttpError(
      'dns_failure',
      `DNS lookup returned no addresses for ${normalized}`,
    );
  }
  if (!allowPrivateNetwork(options)) {
    for (const row of addresses) {
      const error = validatePublicIpAddress(row.address);
      if (error) {
        throw new ExternalHttpError(
          'blocked_address',
          `Outbound request blocked for ${normalized}: ${error}`,
        );
      }
    }
  }
  return addresses;
}

/**
 * Pin undici/Node to addresses we already resolved and SSRF-checked.
 *
 * Node 22+ Happy Eyeballs (`autoSelectFamily`) calls this lookup as
 * `lookup(host, { all: true }, cb)` and expects `LookupAddress[]`. Older
 * `net.connect` / undici paths still use the two-arg form
 * `lookup(host, cb)` or `{ all: false, family }`. The previous implementation
 * only handled the three-arg `{ all: false }` signature: when Node passed
 * `all: true` or omitted `options`, the callback either received the wrong
 * shape or was undefined, so the request failed in 1–2ms without opening TCP.
 */
type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

export function createPinnedAddressLookup(addresses: ResolvedAddress[]): LookupFunction {
  let nextIndex = 0;
  function lookup(hostname: string, options: unknown, callback?: unknown): void {
    const cb = (typeof options === 'function' ? options : callback) as
      PinnedLookupCallback | undefined;
    const opts = (
      typeof options === 'function' || options === undefined || options === null ? {} : options
    ) as LookupOptions;
    if (typeof cb !== 'function') return;

    try {
      const family = opts.family === 4 || opts.family === 6 ? opts.family : undefined;
      const filtered = family ? addresses.filter((row) => row.family === family) : addresses;
      const usable = filtered.length > 0 ? filtered : addresses;
      if (usable.length === 0) {
        const error = Object.assign(new Error(`No validated address available for ${hostname}`), {
          code: 'ENOTFOUND',
        }) as NodeJS.ErrnoException;
        cb(error);
        return;
      }
      if (opts.all) {
        cb(
          null,
          usable.map((row) => ({ address: row.address, family: row.family })),
        );
        return;
      }
      const selected = usable[nextIndex % usable.length];
      nextIndex += 1;
      if (!selected) {
        const error = Object.assign(new Error(`No validated address available for ${hostname}`), {
          code: 'ENOTFOUND',
        }) as NodeJS.ErrnoException;
        cb(error, '');
        return;
      }
      cb(null, selected.address, selected.family);
    } catch (cause) {
      cb(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }
  return lookup;
}

async function readBoundedBody(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number,
  abort: () => void,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    abort();
    throw new ExternalHttpError(
      'response_too_large',
      `External response exceeded ${String(maxBytes)} bytes`,
    );
  }
  if (!response.body) return new Uint8Array();
  const bodyStream = response.body as unknown as {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  };
  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const { value } = result;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        abort();
        await reader.cancel().catch(() => undefined);
        throw new ExternalHttpError(
          'response_too_large',
          `External response exceeded ${String(maxBytes)} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function retryableMethod(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

async function externalFetchAttempt(
  url: URL,
  init: RequestInit,
  options: ExternalFetchOptions,
): Promise<Response> {
  const addresses = await resolveExternalAddresses(url.hostname, options);
  // Keep Happy Eyeballs so a dead validated address can fail over to another
  // in the same SSRF-checked set. createPinnedAddressLookup already answers
  // lookup({ all: true }) with only those addresses.
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedAddressLookup(addresses),
      autoSelectFamily: true,
    },
  });
  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.max(1, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  const timeoutError = new Error('external_fetch_timeout');
  const timeout = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  const callerSignal = init.signal;
  const abortFromCaller = () => {
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const requestInit = {
      ...init,
      dispatcher,
      redirect: init.redirect ?? 'manual',
      signal: controller.signal,
    } as unknown as NonNullable<Parameters<typeof undiciFetch>[1]>;
    const response = await undiciFetch(url, requestInit);
    const body = await readBoundedBody(response, maxBytes, () => {
      controller.abort();
    });
    const responseBody =
      response.status === 204 || response.status === 304 ? null : Uint8Array.from(body).buffer;
    return new Response(responseBody, {
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText,
    });
  } catch (cause) {
    if (cause instanceof ExternalHttpError) throw cause;
    if (controller.signal.reason === timeoutError) {
      throw new ExternalHttpError(
        'timeout',
        `External request timed out after ${String(timeoutMs)}ms`,
        {
          cause,
        },
      );
    }
    if (callerSignal?.aborted) {
      throw new ExternalHttpError('aborted', 'External request was aborted', { cause });
    }
    throw new ExternalHttpError('network_failure', 'External request failed', { cause });
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
    await dispatcher.close();
  }
}

/**
 * Fetches an external URL only after resolving and validating every address,
 * then pins the connector to that validated set to close DNS-rebinding gaps.
 * The returned Response is fully buffered inside the configured deadline and
 * byte cap, so callers cannot accidentally bypass those controls.
 */
export async function externalFetch(
  input: string | URL,
  init: RequestInit = {},
  options: ExternalFetchOptions = {},
): Promise<Response> {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch (cause) {
    throw new ExternalHttpError('invalid_url', 'Invalid external URL', { cause });
  }
  const urlError = validateMcpUrl(url.toString());
  if (urlError) throw new ExternalHttpError('invalid_url', urlError);
  const retries = retryableMethod(init) ? Math.max(0, options.retries ?? 0) : 0;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await externalFetchAttempt(url, init, options);
      if (attempt < retries && RETRYABLE_STATUS.has(response.status)) continue;
      return response;
    } catch (error) {
      if (
        attempt >= retries ||
        !(error instanceof ExternalHttpError) ||
        !['network_failure', 'timeout'].includes(error.code)
      ) {
        throw error;
      }
    }
  }
}
