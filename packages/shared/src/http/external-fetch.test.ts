import { createServer, type RequestListener, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import type { ExternalHttpError } from '#src/http/external-fetch.js';

import { externalFetch, resolveExternalAddresses } from '#src/http/external-fetch.js';

/**
 * The outbound HTTP boundary must reject private DNS results, pin the address
 * it validated, and stop hanging or oversized responses before they can hold
 * worker resources indefinitely.
 */

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

async function listen(handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return address.port;
}

describe('external HTTP boundary', () => {
  it('rejects a hostname when any resolved address is non-public', async () => {
    await expect(
      resolveExternalAddresses('attacker.example', {
        lookup: () =>
          Promise.resolve([
            { address: '8.8.8.8', family: 4 },
            { address: '127.0.0.2', family: 4 },
          ]),
      }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('uses the validated lookup result for the connection', async () => {
    const port = await listen((_request, response) => {
      response.end('pinned');
    });
    let lookups = 0;
    const response = await externalFetch(
      `http://pinned.test:${String(port)}`,
      {},
      {
        allowPrivateNetworkInDevelopment: true,
        lookup: () => {
          lookups += 1;
          return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
        },
      },
    );
    expect(await response.text()).toBe('pinned');
    expect(lookups).toBe(1);
  });

  it('aborts a response that exceeds the streaming byte cap', async () => {
    const port = await listen((_request, response) => {
      response.write('12345678');
      response.end('abcdefgh');
    });
    await expect(
      externalFetch(
        `http://127.0.0.1:${String(port)}`,
        {},
        { allowPrivateNetworkInDevelopment: true, maxResponseBytes: 10 },
      ),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('aborts a hanging response at the configured deadline', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200);
      response.write('started');
    });
    await expect(
      externalFetch(
        `http://127.0.0.1:${String(port)}`,
        {},
        { allowPrivateNetworkInDevelopment: true, timeoutMs: 25 },
      ),
    ).rejects.toEqual(expect.objectContaining<Partial<ExternalHttpError>>({ code: 'timeout' }));
  });

  it('does not retry unsafe methods', async () => {
    let requests = 0;
    const port = await listen((_request, response) => {
      requests += 1;
      response.writeHead(503).end('retry later');
    });
    const response = await externalFetch(
      `http://127.0.0.1:${String(port)}`,
      { method: 'POST' },
      { allowPrivateNetworkInDevelopment: true, retries: 3 },
    );
    expect(response.status).toBe(503);
    expect(requests).toBe(1);
  });

  it('retries explicitly configured safe requests after transient gateway failures', async () => {
    let requests = 0;
    const port = await listen((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(503).end('retry later');
        return;
      }
      response.end('recovered');
    });
    const response = await externalFetch(
      `http://127.0.0.1:${String(port)}`,
      {},
      { allowPrivateNetworkInDevelopment: true, retries: 1 },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('recovered');
    expect(requests).toBe(2);
  });
});
