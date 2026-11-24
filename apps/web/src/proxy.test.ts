import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { NextRequest } from 'next/server';

import { canonicalHostRedirect } from '@/lib/canonical-host';
import { contentSecurityPolicyHeaders } from '@/lib/content-security-policy';
import {
  protectSensitiveLinkResponse,
  sensitiveLinkRequestLogPattern,
} from '@/lib/sensitive-links';
import { isCookieIndependentPublicRead } from '@/proxy';

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

  it('HTTP-redirects legacy Connections URLs so browser hashes survive', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    expect(source).toContain('connectionsLegacyRedirectLocation');
    expect(source).toContain('308');
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

describe('credential URL privacy', () => {
  for (const path of [
    '/verify-email/synthetic?email=fixture@example.test',
    '/sign-up?invite=synthetic',
    '/guest/synthetic-workspace/invite/synthetic-token',
    '/api/calendar/feed/synthetic.ics',
    '/api/webhooks/ingest/synthetic',
    '/api/integrations/github/callback?code=synthetic',
  ]) {
    it(`protects the response and excludes request logging for ${path.split('?')[0]}`, () => {
      const response = Response.redirect('https://timeline.test/sign-in');
      const protectedResponse = protectSensitiveLinkResponse(response, path);
      expect(sensitiveLinkRequestLogPattern.test(path)).toBe(true);
      expect(protectedResponse?.headers.get('cache-control')).toBe('no-store');
      expect(protectedResponse?.headers.get('referrer-policy')).toBe('strict-origin');
      expect(protectedResponse?.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(protectedResponse?.headers.get('location')).toBe('https://timeline.test/sign-in');
      expect(protectedResponse?.status).toBe(302);
    });
  }
});

it('stages CSP and allows only the reviewed browser resource origins', () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    S3_PUBLIC_ENDPOINT: 'https://storage.example.test/path',
  };
  const [report] = contentSecurityPolicyHeaders(env);
  expect(report?.key).toBe('Content-Security-Policy-Report-Only');
  expect(report?.value).toContain('https://challenges.cloudflare.com');
  expect(report?.value).toContain('https://eu.i.posthog.com');
  expect(report?.value).toContain('object-src https://storage.example.test');
  expect(report?.value).not.toContain('storage.example.test/path');
  expect(contentSecurityPolicyHeaders({ ...env, WEB_CSP_MODE: 'enforce' })).toEqual([
    { key: 'Content-Security-Policy', value: report?.value },
  ]);
  const [withStorageFallback] = contentSecurityPolicyHeaders({
    ...env,
    S3_PUBLIC_ENDPOINT: ' ',
    S3_ENDPOINT: 'https://fallback-storage.example.test',
  });
  expect(withStorageFallback?.value).toContain('object-src https://fallback-storage.example.test');
  const [withoutStorage] = contentSecurityPolicyHeaders({
    ...env,
    S3_PUBLIC_ENDPOINT: 'https://credential@storage.example.test',
  });
  expect(withoutStorage?.value).toContain("object-src 'none'");
});

describe('public request routing', () => {
  it('bypasses auth for public reads even with a session cookie', () => {
    for (const path of ['/', '/features', '/pricing', '/integrations/telegram', '/guides']) {
      for (const method of ['GET', 'HEAD']) {
        expect(
          isCookieIndependentPublicRead(
            new NextRequest(`https://example.test${path}`, {
              method,
              headers: { cookie: 'authjs.session-token=synthetic' },
            }),
          ),
        ).toBe(true);
      }
    }
  });

  it('retains auth for actions, session APIs and product routes', () => {
    for (const path of [
      '/app',
      '/api/auth/session',
      '/sign-up?plan=team',
      '/sign-up?source=slack',
      '/onboarding',
    ]) {
      expect(isCookieIndependentPublicRead(new NextRequest(`https://example.test${path}`))).toBe(
        false,
      );
    }
    expect(
      isCookieIndependentPublicRead(new NextRequest('https://example.test/', { method: 'POST' })),
    ).toBe(false);
    expect(
      isCookieIndependentPublicRead(
        new NextRequest('https://example.test/', {
          headers: { 'next-action': 'synthetic' },
        }),
      ),
    ).toBe(false);
  });
});
