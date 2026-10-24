import { describe, expect, it, vi } from 'vitest';

import { readJson } from '@/lib/paginated-api';

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

    await expect(readJson(response, navigate)).rejects.toThrow('legal_acceptance_required');
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

    await expect(readJson(response, navigate)).rejects.toThrow('legal_acceptance_required');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves ordinary API error behavior', async () => {
    const navigate = vi.fn();
    const response = Response.json({ error: 'request_failed' }, { status: 500 });

    await expect(readJson(response, navigate)).rejects.toThrow('request_failed');
    expect(navigate).not.toHaveBeenCalled();
  });
});
