import { afterEach, describe, expect, it } from 'vitest';

import { getSiteUrl } from '@/lib/site-url';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('getSiteUrl', () => {
  it('prefers explicit AUTH_URL over deployment and legacy URLs', () => {
    process.env.AUTH_URL = 'https://app.timeline.example';
    process.env.VERCEL_URL = 'timeline-preview.vercel.app';
    process.env.NEXTAUTH_URL = 'https://production.timeline.example';

    expect(getSiteUrl()).toBe('https://app.timeline.example');
  });

  it('prefers VERCEL_URL over NEXTAUTH_URL for preview deployments', () => {
    process.env.AUTH_URL = '';
    process.env.VERCEL_URL = 'timeline-preview.vercel.app';
    process.env.NEXTAUTH_URL = 'https://production.timeline.example';

    expect(getSiteUrl()).toBe('https://timeline-preview.vercel.app');
  });

  it('uses NEXTAUTH_URL as a legacy fallback after platform URLs', () => {
    process.env.AUTH_URL = '';
    delete process.env.VERCEL_URL;
    process.env.NEXTAUTH_URL = 'https://production.timeline.example';

    expect(getSiteUrl()).toBe('https://production.timeline.example');
  });

  it('falls back to localhost when no site URL env is configured', () => {
    delete process.env.AUTH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;

    expect(getSiteUrl()).toBe('http://localhost:3000');
  });
});
