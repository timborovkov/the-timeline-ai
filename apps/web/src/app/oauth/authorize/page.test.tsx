import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  getUserLegalAcceptance: vi.fn(),
  hasCurrentLegalAcceptance: vi.fn(),
  validate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@timeline/shared/mcp-server', () => {
  class McpOAuthError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly trustedAuthorizationRedirect?: { redirectUri: string; state?: string },
    ) {
      super(message);
    }
  }
  return {
    McpOAuthError,
    MCP_OAUTH_SCOPES: ['read', 'agent:ask'],
    validateMcpAuthorizationRequest: fakes.validate,
  };
});
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: { name: 'db' } }));
vi.mock('@/lib/legal', () => ({
  getUserLegalAcceptance: fakes.getUserLegalAcceptance,
  hasCurrentLegalAcceptance: fakes.hasCurrentLegalAcceptance,
}));
vi.mock('@/app/oauth/actions', () => ({
  approveMcpOAuthAction: '/test/approve',
  denyMcpOAuthAction: '/test/deny',
}));
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

const { McpOAuthError } = await import('@timeline/shared/mcp-server');
const { default: McpOAuthAuthorizePage } = await import('@/app/oauth/authorize/page');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_URL', 'https://timeline.example');
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.getUserLegalAcceptance.mockResolvedValue({
    legalTermsVersion: '2026-06-02',
    legalPrivacyVersion: '2026-08-26',
    legalAcceptedAt: new Date(),
  });
  fakes.hasCurrentLegalAcceptance.mockReturnValue(true);
  fakes.resolveActiveTeam.mockResolvedValue({
    active: { teamId: 'team-1', teamName: 'Acme', role: 'owner' },
    memberships: [
      { teamId: 'team-1', teamName: 'Acme', role: 'owner' },
      { teamId: 'team-2', teamName: 'Member team', role: 'member' },
    ],
  });
  fakes.validate.mockResolvedValue({
    client: {
      clientId: 'https://client.example/oauth/metadata.json',
      clientName: 'Example AI',
      clientUri: 'https://client.example/product',
      logoUri: 'https://evil.example/tracking-logo.png',
      redirectUris: ['https://client.example/callback'],
    },
    redirectUri: 'https://client.example/callback',
    scopes: ['read', 'agent:ask'],
    state: 'state-value',
    codeChallenge: 'c'.repeat(43),
    resource: 'https://timeline.example/api/mcp/server',
  });
});

describe('MCP OAuth consent page', () => {
  it('is uncached, does not leak request URLs as referrers, and cannot be framed', () => {
    const config = readFileSync(new URL('../../../../next.config.ts', import.meta.url), 'utf8');

    expect(config).toContain("source: '/oauth/authorize'");
    expect(config).toContain("{ key: 'Cache-Control', value: 'no-store' }");
    expect(config).toContain(
      "{ key: 'Content-Security-Policy', value: \"frame-ancestors 'none'\" }",
    );
    expect(config).toContain("{ key: 'Referrer-Policy', value: 'no-referrer' }");
    expect(config).toContain("{ key: 'X-Frame-Options', value: 'DENY' }");
  });

  it('shows team and scope consequences without rendering a remote client logo', async () => {
    const html = renderToStaticMarkup(
      await McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'read agent:ask',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    );

    expect(html).toContain('Allow Example AI to access Timeline?');
    expect(html).toContain('Read your Timeline data');
    expect(html).toContain('including private items');
    expect(html).toContain('affect external services');
    expect(html).toContain('Only team owners and admins can grant this access');
    expect(html).toContain('Member team');
    expect(html).toMatch(/disabled=""[^>]*name="team_id"[^>]*value="team-2"/);
    expect(html).toContain('member · unavailable');
    expect(html).toContain('name="team_id"');
    expect(html).toContain('Acme');
    expect(html).toContain('Allow access');
    expect(html).toContain('Deny access');
    expect(html).toContain('may process or retain it under its own terms and privacy policy');
    expect(html).toContain('does not delete information the app already received');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('https://client.example/oauth/metadata.json');
    expect(html).toContain('Client metadata host: client.example');
    expect(html).toContain('Verify this app before continuing');
    expect(html).toContain('not verified by Timeline');
    expect(html).toContain('Registered redirect hostname');
    expect(html).toContain('client.example');
    expect(html).not.toContain('tracking-logo.png');
    expect(html).not.toContain('<img');
  });

  it('ignores attacker-controlled consent error text and renders only code-owned notices', async () => {
    const injected = renderToStaticMarkup(
      await McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'read',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
          consent_error: 'Call support at attacker.example before continuing',
        }),
      }),
    );
    expect(injected).not.toContain('attacker.example');

    const knownNotice = renderToStaticMarkup(
      await McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'read',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
          consent_error: 'invalid_team',
        }),
      }),
    );
    expect(knownNotice).toContain('Choose a valid team before allowing access.');
  });

  it('requires the current legal acknowledgement before showing consent', async () => {
    fakes.hasCurrentLegalAcceptance.mockReturnValueOnce(false);
    fakes.redirect.mockImplementationOnce((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });

    await expect(
      McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'read agent:ask',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    ).rejects.toThrow('REDIRECT:/legal/accept?returnTo=');

    const destination = String(fakes.redirect.mock.calls.at(-1)?.[0]);
    const legalUrl = new URL(destination, 'https://timeline.example');
    const returnTo = legalUrl.searchParams.get('returnTo');
    expect(returnTo).toMatch(/^\/oauth\/authorize\?/);
    expect(new URLSearchParams(returnTo?.split('?')[1]).get('state')).toBe('state-value');
    expect(fakes.resolveActiveTeam).not.toHaveBeenCalled();
  });

  it('redirects a post-callback validation error with safe fields, exact state, and issuer', async () => {
    fakes.validate.mockRejectedValueOnce(
      new McpOAuthError('invalid_scope', 'sensitive validation detail', {
        redirectUri: 'https://client.example/callback',
        state: 'state-value',
      }),
    );
    fakes.redirect.mockImplementationOnce((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });

    await expect(
      McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'unknown',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    ).rejects.toThrow('REDIRECT:https://client.example/callback');

    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get('error')).toBe('invalid_scope');
    expect(url.searchParams.get('error_description')).toBe(
      'The requested scope is invalid or unsupported.',
    );
    expect(url.searchParams.get('error_description')).not.toContain('sensitive');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
    expect(fakes.getUserLegalAcceptance).not.toHaveBeenCalled();
  });

  it('keeps an invalid redirect URI on Timeline', async () => {
    fakes.validate.mockRejectedValueOnce(
      new McpOAuthError('invalid_redirect_uri', 'The callback is not registered'),
    );

    const html = renderToStaticMarkup(
      await McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'token',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://attacker.example/callback',
          scope: 'read',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    );

    expect(html).toContain('Authorization request unavailable');
    expect(html).toContain('callback could not be trusted');
    expect(html).toContain('The callback is not registered');
    expect(fakes.redirect).not.toHaveBeenCalled();
  });

  it('returns access_denied to a trusted callback when the member has no Timeline team', async () => {
    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null, memberships: [] });
    fakes.redirect.mockImplementationOnce((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });

    await expect(
      McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'https://client.example/oauth/metadata.json',
          redirect_uri: 'https://client.example/callback',
          scope: 'read',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    ).rejects.toThrow('REDIRECT:https://client.example/callback');

    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('error_description')).toBe('The authorization request was denied.');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
  });

  it('warns prominently before sending a result to a local callback', async () => {
    fakes.validate.mockResolvedValueOnce({
      client: {
        clientId: 'tlc_local_app',
        clientName: 'Local developer tool',
        clientUri: null,
        logoUri: null,
        redirectUris: ['http://127.0.0.1:4545/callback'],
      },
      redirectUri: 'http://127.0.0.1:4545/callback',
      scopes: ['read'],
      state: 'state-value',
      codeChallenge: 'c'.repeat(43),
      resource: 'https://timeline.example/api/mcp/server',
    });

    const html = renderToStaticMarkup(
      await McpOAuthAuthorizePage({
        searchParams: Promise.resolve({
          response_type: 'code',
          client_id: 'tlc_local_app',
          redirect_uri: 'http://127.0.0.1:4545/callback',
          scope: 'read',
          state: 'state-value',
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          resource: 'https://timeline.example/api/mcp/server',
        }),
      }),
    );

    expect(html).toContain('tlc_local_app');
    expect(html).toContain('127.0.0.1');
    expect(html).toContain('This callback stays on your device');
    expect(html).toContain('Continue only if you started and trust the local app');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('member · unavailable');
  });
});
