import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from 'next-auth';

import { authorizeProductRequest, hasCurrentLegalSession } from '@/lib/auth.config';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(path: string, activeTeamCookie?: string): NextRequest {
  return new NextRequest(`https://timeline.test${path}`, {
    headers: activeTeamCookie ? { cookie: `tl_active_team=${activeTeamCookie}` } : undefined,
  });
}

function session(current = true): Session {
  return {
    expires: '2099-01-01T00:00:00.000Z',
    user: {
      id: 'user-1',
      legalTermsVersion: current ? TERMS_VERSION : 'older-terms',
      legalPrivacyVersion: current ? PRIVACY_VERSION : 'older-privacy',
      legalAcceptedAt: current ? '2026-08-21T10:00:00.000Z' : null,
    },
  };
}

describe('hasCurrentLegalSession', () => {
  it('requires both current signed versions and an acceptance timestamp', () => {
    expect(hasCurrentLegalSession(session().user)).toBe(true);
    expect(hasCurrentLegalSession(session(false).user)).toBe(false);
    expect(hasCurrentLegalSession(undefined)).toBe(false);
  });
});

describe('authorizeProductRequest', () => {
  it('does not enforce an unpublished legal version in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_PUBLICATION_READY', 'false');

    expect(
      authorizeProductRequest({ auth: session(false), request: request('/app/timeline') }),
    ).toBe(true);
    expect(
      authorizeProductRequest({ auth: session(false), request: request('/api/timeline') }),
    ).toBe(true);
  });

  it('keeps the existing sign-in gate for unauthenticated app requests', () => {
    const result = authorizeProductRequest({
      auth: null,
      request: request('/app/timeline?view=all', TEAM_ID),
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://timeline.test/sign-in?callbackUrl=https%3A%2F%2Ftimeline.test%2Fapp%2Ftimeline%3Fview%3Dall',
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('does not slide or delete a current active-team cookie during sign-in redirect', () => {
    const result = authorizeProductRequest({
      auth: null,
      request: request('/app/timeline', `v2:${TEAM_ID}`),
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.has('set-cookie')).toBe(false);
  });

  it('allows users with current signed legal claims into the product', () => {
    expect(authorizeProductRequest({ auth: session(), request: request('/app/timeline') })).toBe(
      true,
    );
    expect(authorizeProductRequest({ auth: session(), request: request('/api/timeline') })).toBe(
      true,
    );
  });

  it('redirects stale app and invite sessions to the legal gate with a safe return path', () => {
    const appResponse = authorizeProductRequest({
      auth: session(false),
      request: request('/app/timeline?view=all'),
    });
    const inviteResponse = authorizeProductRequest({
      auth: session(false),
      request: request('/accept-invite/invite-token'),
    });

    expect(appResponse).toBeInstanceOf(Response);
    expect((appResponse as Response).status).toBe(302);
    expect((appResponse as Response).headers.get('location')).toBe(
      'https://timeline.test/legal/accept?returnTo=%2Fapp%2Ftimeline%3Fview%3Dall',
    );
    expect((inviteResponse as Response).headers.get('location')).toBe(
      'https://timeline.test/legal/accept?returnTo=%2Faccept-invite%2Finvite-token',
    );
  });

  it('returns a no-store 428 contract for stale authenticated human product APIs', async () => {
    const result = authorizeProductRequest({
      auth: session(false),
      request: request('/api/documents/search?q=roadmap'),
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(428);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'legal_acceptance_required',
      message: 'Accept the current Terms of Use and acknowledge the Privacy Policy.',
      acceptanceUrl: '/legal/accept?returnTo=%2Fapp',
    });
  });

  it.each([
    '/api/auth/session',
    '/api/calendar/feed/token.ics',
    '/api/cron/reconcile',
    '/api/email/inbound',
    '/api/health',
    '/api/mcp/server',
    '/api/slack/commands',
    '/api/slack/events',
    '/api/slack/interactions',
    '/api/telegram/webhook',
    '/api/webhooks/recall/status',
  ])('does not apply human clickwrap to machine endpoint %s', (path) => {
    expect(authorizeProductRequest({ auth: session(false), request: request(path) })).toBe(true);
  });

  it('leaves public routes and unauthenticated API auth semantics to their handlers', () => {
    expect(authorizeProductRequest({ auth: session(false), request: request('/privacy') })).toBe(
      true,
    );
    expect(authorizeProductRequest({ auth: null, request: request('/api/timeline') })).toBe(true);
  });
});
