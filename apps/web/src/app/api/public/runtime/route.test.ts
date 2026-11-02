import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  getEnv: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/env'),
  () => ({ getEnv: fakes.getEnv }),
  () => import('@timeline/shared/env'),
);

const { GET } = await import('./route.js');
const { DEFAULT_SUPPORT_EMAIL } = await import('@/lib/support-links');

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  fakes.getEnv.mockReset();
});

describe('GET /api/public/runtime', () => {
  it('returns request-time public config without caching', async () => {
    vi.stubEnv('SUPPORT_EMAIL', '  help@example.test  ');
    vi.stubEnv('NODE_ENV', 'production');
    fakes.getEnv.mockReturnValue({
      TURNSTILE_SITE_KEY: '  runtime-site-key  ',
      TASK_CATEGORY_UI_ENABLED: false,
      NEXT_PUBLIC_POSTHOG_KEY: 'ph-runtime',
      NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    });

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      supportEmail: 'help@example.test',
      turnstileSiteKey: 'runtime-site-key',
      requiresTurnstile: true,
      taskCategoriesEnabled: false,
      publicPostHogKey: 'ph-runtime',
      publicPostHogHost: 'https://eu.i.posthog.com',
    });
  });

  it('falls back to the canonical support address when SUPPORT_EMAIL is unset', async () => {
    vi.stubEnv('SUPPORT_EMAIL', '');
    vi.stubEnv('NODE_ENV', 'test');
    fakes.getEnv.mockReturnValue({
      TASK_CATEGORY_UI_ENABLED: true,
    });

    const response = GET();

    expect(await response.json()).toEqual({
      supportEmail: DEFAULT_SUPPORT_EMAIL,
      turnstileSiteKey: null,
      requiresTurnstile: false,
      taskCategoriesEnabled: true,
      publicPostHogKey: null,
      publicPostHogHost: null,
    });
  });
});
