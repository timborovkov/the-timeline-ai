import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

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
    super(message, options);
    this.name = 'ExternalHttpError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ExternalLookup = (hostname: string) => Promise<ResolvedAddress[]>;

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
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.flatMap((row) =>
    row.family === 4 || row.family === 6 ? [{ address: row.address, family: row.family }] : [],
  );
}

export async function resolveExternalAddresses(
  hostname: string,
  options: Pick<ExternalFetchOptions, 'allowPrivateNetworkInDevelopment' | 'lookup'> = {},
): Promise<ResolvedAddress[]> {
  const normalized = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
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
    throw new ExternalHttpError('dns_failure', `DNS lookup returned no addresses for ${normalized}`);
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

function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  let nextIndex = 0;
  return (
    _hostname: string,
    options,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void,
  ): void => {
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const selected = addresses[nextIndex % addresses.length];
    nextIndex += 1;
    if (!selected) {
      callback(Object.assign(new Error('No validated address available'), { code: 'ENOTFOUND' }), '');
      return;
    }
    callback(null, selected.address, selected.family);
  };
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
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.max(1, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
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
    const responseBody = response.status === 204 || response.status === 304
      ? null
      : Uint8Array.from(body).buffer;
    return new Response(responseBody, {
      headers: [...response.headers.entries()],
      status: response.status,
      statusText: response.statusText,
    });
  } catch (cause) {
    if (cause instanceof ExternalHttpError) throw cause;
    if (timedOut) {
      throw new ExternalHttpError('timeout', `External request timed out after ${String(timeoutMs)}ms`, {
        cause,
      });
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
