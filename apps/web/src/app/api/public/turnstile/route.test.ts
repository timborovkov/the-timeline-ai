import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  getEnv: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({ getEnv: fakes.getEnv }),
  () => import('@timeline/shared/env'),
);

const { GET } = await import('./route.js');

beforeEach(() => {
  fakes.getEnv.mockReset();
});

describe('GET /api/public/turnstile', () => {
  it('returns the runtime Turnstile site key without caching', async () => {
    fakes.getEnv.mockReturnValue({ TURNSTILE_SITE_KEY: '  runtime-site-key  ' });

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ siteKey: 'runtime-site-key' });
  });

  it('returns null when the runtime site key is unset', async () => {
    fakes.getEnv.mockReturnValue({});

    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ siteKey: null });
  });
});
