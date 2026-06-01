import { afterEach, describe, expect, it } from 'vitest';

import { safeSameOriginPath } from '@/lib/safe-redirect';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('safeSameOriginPath', () => {
  it('falls back when the configured base URL is malformed', () => {
    process.env.AUTH_URL = '';
    process.env.NEXTAUTH_URL = 'not a url';

    expect(safeSameOriginPath('/app', '/fallback')).toBe('/fallback');
  });

  it('allows same-origin callback paths', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    delete process.env.NEXTAUTH_URL;

    expect(safeSameOriginPath('/app/timeline?tab=all', '/fallback')).toBe('/app/timeline?tab=all');
  });

  it('rejects external and protocol-relative callback paths', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    delete process.env.NEXTAUTH_URL;

    expect(safeSameOriginPath('https://evil.example/app', '/fallback')).toBe('/fallback');
    expect(safeSameOriginPath('//evil.example/app', '/fallback')).toBe('/fallback');
    expect(safeSameOriginPath('/\\evil.example/app', '/fallback')).toBe('/fallback');
  });
});
