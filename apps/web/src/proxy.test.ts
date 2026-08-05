import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalHostRedirect } from '@/lib/canonical-host';

const ORIGINAL_AUTH_URL = process.env.AUTH_URL;
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

afterEach(() => {
  process.env.AUTH_URL = ORIGINAL_AUTH_URL;
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

describe('proxy matcher', () => {
  it('excludes the Sentry tunnel route', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(source).toContain('sentry-tunnel');
  });

  it('excludes the Railway health check route', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(source).toContain('api/health');
  });

  it('rejects malformed multipart bodies before auth', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(source).toContain('rejectInvalidMultipartRequest');
  });
});

describe('canonicalHostRedirect', () => {
  it('redirects alternate hosts to AUTH_URL while preserving path and query', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    process.env.NEXTAUTH_URL = '';
    const request = new NextRequest('https://www.thetimeline.cc/app?tab=home', {
      headers: { host: 'www.thetimeline.cc', 'x-forwarded-proto': 'https' },
    });

    const response = canonicalHostRedirect(request);

    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe('https://thetimeline.cc/app?tab=home');
  });

  it('does not redirect the configured canonical origin', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    process.env.NEXTAUTH_URL = '';
    const request = new NextRequest('https://thetimeline.cc/app', {
      headers: { host: 'thetimeline.cc', 'x-forwarded-proto': 'https' },
    });

    expect(canonicalHostRedirect(request)).toBeNull();
  });

  it('normalizes forwarded protocol casing before comparing origins', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    process.env.NEXTAUTH_URL = '';
    const request = new NextRequest('https://thetimeline.cc/app', {
      headers: { host: 'thetimeline.cc', 'x-forwarded-proto': 'HTTPS' },
    });

    expect(canonicalHostRedirect(request)).toBeNull();
  });

  it('does not redirect when no canonical env is configured', () => {
    process.env.AUTH_URL = '';
    process.env.NEXTAUTH_URL = '';
    const request = new NextRequest('http://localhost:3000/app');

    expect(canonicalHostRedirect(request)).toBeNull();
  });

  it('does not redirect the health check route from probe hosts', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    process.env.NEXTAUTH_URL = '';
    const request = new NextRequest('https://healthcheck.railway.app/api/health', {
      headers: { host: 'healthcheck.railway.app', 'x-forwarded-proto': 'https' },
    });

    expect(canonicalHostRedirect(request)).toBeNull();
  });
});
