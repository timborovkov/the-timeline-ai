import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { CANONICAL_PUBLIC_ORIGIN, getSiteUrl } from '@/lib/site-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSiteUrl', () => {
  it('prefers explicit AUTH_URL over deployment and legacy URLs', () => {
    vi.stubEnv('AUTH_URL', 'https://app.timeline.example/');
    vi.stubEnv('VERCEL_URL', 'timeline-preview.vercel.app');
    vi.stubEnv('NEXTAUTH_URL', 'https://production.timeline.example');

    expect(getSiteUrl()).toBe('https://app.timeline.example');
  });

  it('prefers VERCEL_URL over NEXTAUTH_URL for preview deployments', () => {
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('VERCEL_URL', 'timeline-preview.vercel.app');
    vi.stubEnv('NEXTAUTH_URL', 'https://production.timeline.example');

    expect(getSiteUrl()).toBe('https://timeline-preview.vercel.app');
  });

  it('uses NEXTAUTH_URL as a legacy fallback after platform URLs', () => {
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('NEXTAUTH_URL', 'https://production.timeline.example/app');

    expect(getSiteUrl()).toBe('https://production.timeline.example');
  });

  it('falls back to localhost outside production when no site URL env is configured', () => {
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');
    vi.stubEnv('NODE_ENV', 'test');

    expect(getSiteUrl()).toBe('http://localhost:3000');
  });

  it('uses the canonical public origin for production builds without AUTH_URL', () => {
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    expect(getSiteUrl()).toBe(CANONICAL_PUBLIC_ORIGIN);
    expect(getSiteUrl()).toBe('https://thetimeline.cc');
  });
});
