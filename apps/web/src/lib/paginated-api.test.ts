import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { readJson } from '@/lib/api-response';
describe('readJson', () => {
  it('routes a stale API session through the legal gate to an app page', async () => {
    const navigate = vi.fn();
    const response = Response.json(
      {
        error: 'legal_acceptance_required',
        acceptanceUrl: '/legal/accept?returnTo=%2Fapp',
      },
      { status: 428 },
    );

    await expect(readJson(response, { navigate })).rejects.toMatchObject({ code: 'legal_acceptance_required', message: 'Request failed (428)' });
    expect(navigate).toHaveBeenCalledWith('/legal/accept?returnTo=%2Fapp');
  });

  it.each([
    'https://attacker.example/legal/accept?returnTo=%2Fapp',
    '//attacker.example/legal/accept?returnTo=%2Fapp',
    '/legal/accept?returnTo=https%3A%2F%2Fattacker.example',
    '/legal/accept?returnTo=%2Fapi%2Fsearch',
  ])('does not navigate to an unsafe acceptance target: %s', async (acceptanceUrl) => {
    const navigate = vi.fn();
    const response = Response.json(
      { error: 'legal_acceptance_required', acceptanceUrl },
      { status: 428 },
    );

    await expect(readJson(response, { navigate })).rejects.toMatchObject({ code: 'legal_acceptance_required', message: 'Request failed (428)' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves ordinary API error behavior', async () => {
    const navigate = vi.fn();
    const response = Response.json({ error: 'request_failed' }, { status: 500 });

    await expect(readJson(response, { navigate })).rejects.toMatchObject({ code: 'request_failed', message: 'Request failed (500)' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('API response boundary', () => {
  it('keeps support references with structured failures', async () => {
    await expect(
      readJson(Response.json({ error: 'request_failed', reference: 'abc123' }, { status: 500 })),
    ).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      reference: 'abc123',
      message: 'Request failed (500) Reference: abc123.',
    });
  });

  it('does not expose raw non-JSON server failures', async () => {
    await expect(
      readJson(new Response('internal provider token=secret', { status: 502 })),
    ).rejects.toThrow('Request failed (502)');
  });

  it('keeps JSON provider details out of display messages', async () => {
    await expect(
      readJson(Response.json({ error: 'internal provider token=secret' }, { status: 502 })),
    ).rejects.toMatchObject({
      code: 'internal provider token=secret',
      message: 'Request failed (502)',
    });
  });

  it('accepts an empty success only when the caller declares its empty value', async () => {
    await expect(readJson(new Response(null, { status: 204 }))).rejects.toThrow(
      'Empty server response.',
    );
    await expect(
      readJson(new Response(null, { status: 204 }), { emptyValue: {} }),
    ).resolves.toEqual({});
    await expect(
      readJson(new Response('broken JSON', { status: 200 }), { emptyValue: {} }),
    ).rejects.toThrow('Invalid server response.');
  });
});
