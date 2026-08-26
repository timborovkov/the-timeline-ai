import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserLegalAcceptance: vi.fn(),
  hasCurrentLegalAcceptance: vi.fn(),
  validate: vi.fn(),
  createCode: vi.fn(),
  revokeGrant: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  revalidatePath: vi.fn(),
  reportCaughtError: vi.fn(),
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
    createMcpAuthorizationCode: fakes.createCode,
    revokeMcpOAuthGrant: fakes.revokeGrant,
    withMcpOAuthTrustedAuthorizationRedirect: (
      error: unknown,
      trustedAuthorizationRedirect: { redirectUri: string; state?: string },
    ) =>
      error instanceof McpOAuthError
        ? new McpOAuthError(error.code, error.message, trustedAuthorizationRedirect)
        : new McpOAuthError(
            'server_error',
            'Timeline could not complete the authorization request',
            trustedAuthorizationRedirect,
          ),
  };
});
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/db', () => ({ db: { name: 'db' } }));
vi.mock('@/lib/legal', () => ({
  getUserLegalAcceptance: fakes.getUserLegalAcceptance,
  hasCurrentLegalAcceptance: fakes.hasCurrentLegalAcceptance,
}));
vi.mock('@/lib/sentry-report', () => ({ reportCaughtError: fakes.reportCaughtError }));

const { McpOAuthError } = await import('@timeline/shared/mcp-server');
const { approveMcpOAuthAction, denyMcpOAuthAction, revokeMcpOAuthGrantAction } =
  await import('@/app/oauth/actions');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const RESOURCE = 'https://timeline.example/api/mcp/server';
const VALIDATED_REQUEST = {
  client: {
    clientId: 'https://claude.ai/oauth/client-metadata.json',
    clientName: 'Claude',
    redirectUris: [REDIRECT_URI],
    clientUri: 'https://claude.ai',
    logoUri: 'https://claude.ai/logo.png',
  },
  redirectUri: REDIRECT_URI,
  scopes: ['read', 'agent:ask'],
  state: 'state-value',
  codeChallenge: 'c'.repeat(43),
  resource: RESOURCE,
};

function consentForm(): FormData {
  const formData = new FormData();
  formData.set('response_type', 'code');
  formData.set('client_id', 'https://claude.ai/oauth/client-metadata.json');
  formData.set('redirect_uri', REDIRECT_URI);
  formData.set('scope', 'read agent:ask');
  formData.set('state', 'state-value');
  formData.set('code_challenge', 'c'.repeat(43));
  formData.set('code_challenge_method', 'S256');
  formData.set('resource', RESOURCE);
  formData.set('team_id', TEAM_ID);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_URL', 'https://timeline.example');
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.getUserLegalAcceptance.mockResolvedValue({
    legalTermsVersion: '2026-06-02',
    legalPrivacyVersion: '2026-08-26',
    legalAcceptedAt: new Date(),
  });
  fakes.hasCurrentLegalAcceptance.mockReturnValue(true);
  fakes.validate.mockResolvedValue(VALIDATED_REQUEST);
  fakes.createCode.mockResolvedValue('tlc_code_once');
  fakes.revokeGrant.mockResolvedValue(true);
});

describe('MCP OAuth consent actions', () => {
  it('approves for the signed-in user and chosen team, then binds code, state, and issuer', async () => {
    await expect(approveMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    expect(fakes.createCode).toHaveBeenCalledWith(expect.anything(), {
      request: VALIDATED_REQUEST,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const destination = String(fakes.redirect.mock.calls.at(-1)?.[0]);
    const url = new URL(destination);
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code')).toBe('tlc_code_once');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
  });

  it('denies only after revalidating the registered redirect URI', async () => {
    await expect(denyMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    expect(fakes.validate).toHaveBeenCalledOnce();
    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
  });

  it('keeps validation failures on Timeline instead of redirecting to untrusted input', async () => {
    fakes.validate.mockRejectedValueOnce(
      new McpOAuthError('invalid_redirect_uri', 'Callback is not registered'),
    );

    await expect(approveMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    const destination = String(fakes.redirect.mock.calls.at(-1)?.[0]);
    expect(destination).toMatch(/^\/oauth\/authorize\?/);
    expect(destination).toContain('consent_error=request_failed');
    expect(destination).not.toContain('Callback+is+not+registered');
    expect(destination).not.toMatch(/^https?:/);
    expect(fakes.createCode).not.toHaveBeenCalled();
  });

  it('returns an invalid resource error to the exact callback on approval', async () => {
    fakes.validate.mockRejectedValueOnce(
      new McpOAuthError('invalid_target', 'sensitive resource validation detail', {
        redirectUri: REDIRECT_URI,
        state: 'state-value',
      }),
    );

    await expect(approveMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('invalid_target');
    expect(url.searchParams.get('error_description')).toBe(
      'The requested resource is invalid or unsupported.',
    );
    expect(url.searchParams.get('error_description')).not.toContain('sensitive');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
    expect(fakes.createCode).not.toHaveBeenCalled();
  });

  it('returns an unsupported response type error to the exact callback on denial', async () => {
    fakes.validate.mockRejectedValueOnce(
      new McpOAuthError('unsupported_response_type', 'Only code is supported', {
        redirectUri: REDIRECT_URI,
        state: 'state-value',
      }),
    );

    await expect(denyMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('unsupported_response_type');
    expect(url.searchParams.get('error_description')).toBe(
      'The requested response type is not supported.',
    );
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
  });

  it('returns post-validation membership denial without leaking role details', async () => {
    fakes.createCode.mockRejectedValueOnce(
      new McpOAuthError('access_denied', 'Only a team owner or admin can authorize this scope'),
    );

    await expect(approveMcpOAuthAction(consentForm())).rejects.toThrow('REDIRECT:');

    const url = new URL(String(fakes.redirect.mock.calls.at(-1)?.[0]));
    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('error_description')).toBe('The authorization request was denied.');
    expect(url.searchParams.get('error_description')).not.toContain('owner');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');
  });

  it('cannot approve a grant before acknowledging the current privacy policy', async () => {
    fakes.hasCurrentLegalAcceptance.mockReturnValueOnce(false);

    await expect(approveMcpOAuthAction(consentForm())).rejects.toThrow(
      'REDIRECT:/legal/accept?returnTo=',
    );

    const destination = String(fakes.redirect.mock.calls.at(-1)?.[0]);
    const legalUrl = new URL(destination, 'https://timeline.example');
    const returnTo = legalUrl.searchParams.get('returnTo');
    expect(returnTo).toMatch(/^\/oauth\/authorize\?/);
    expect(new URLSearchParams(returnTo?.split('?')[1]).get('client_id')).toBe(
      'https://claude.ai/oauth/client-metadata.json',
    );
    expect(fakes.validate).toHaveBeenCalledOnce();
    expect(fakes.createCode).not.toHaveBeenCalled();
  });

  it('revokes only the signed-in user’s grant in the submitted team', async () => {
    const formData = new FormData();
    formData.set('grant_id', '33333333-3333-4333-8333-333333333333');
    formData.set('team_id', TEAM_ID);

    await expect(revokeMcpOAuthGrantAction(formData)).rejects.toThrow('REDIRECT:');

    expect(fakes.revokeGrant).toHaveBeenCalledWith(expect.anything(), {
      grantId: '33333333-3333-4333-8333-333333333333',
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app/me/connections');
    expect(fakes.redirect).toHaveBeenLastCalledWith('/app/me/connections?mcpRevoked=1');
  });
});
