import { McpOAuthError } from '@timeline/shared/mcp-server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as getAuthorizationServerMetadata } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as getPathProtectedResourceMetadata } from '@/app/.well-known/oauth-protected-resource/api/mcp/server/route';
import { GET as getRootProtectedResourceMetadata } from '@/app/.well-known/oauth-protected-resource/route';
import {
  mcpAuthorizationServerMetadata,
  mcpProtectedResourceMetadata,
  oauthAuthorizationErrorRedirect,
} from '@/lib/mcp-oauth-server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Timeline MCP OAuth metadata', () => {
  it('publishes identical RFC 9728 metadata at the root and path-specific locations', async () => {
    vi.stubEnv('AUTH_URL', 'https://timeline.example/ignored/path');
    const expected = {
      resource: 'https://timeline.example/api/mcp/server',
      authorization_servers: ['https://timeline.example'],
      scopes_supported: ['read', 'agent:ask'],
      bearer_methods_supported: ['header'],
      resource_name: 'Timeline MCP',
      resource_documentation: 'https://timeline.example/help',
      resource_policy_uri: 'https://timeline.example/privacy',
      resource_tos_uri: 'https://timeline.example/terms',
    };

    expect(mcpProtectedResourceMetadata()).toEqual(expected);
    for (const response of [
      getRootProtectedResourceMetadata(),
      getPathProtectedResourceMetadata(),
    ]) {
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      await expect(response.json()).resolves.toEqual(expected);
    }
  });

  it('publishes OAuth 2.1, PKCE, CIMD, DCR, and revocation capabilities without OIDC metadata', async () => {
    vi.stubEnv('AUTH_URL', 'https://timeline.example');
    const metadata = mcpAuthorizationServerMetadata();

    expect(metadata).toMatchObject({
      issuer: 'https://timeline.example',
      authorization_endpoint: 'https://timeline.example/oauth/authorize',
      token_endpoint: 'https://timeline.example/oauth/token',
      registration_endpoint: 'https://timeline.example/oauth/register',
      revocation_endpoint: 'https://timeline.example/oauth/revoke',
      scopes_supported: ['read', 'agent:ask'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
    });
    expect(metadata).not.toHaveProperty('jwks_uri');
    expect(metadata).not.toHaveProperty('userinfo_endpoint');
    expect(metadata).not.toHaveProperty('id_token_signing_alg_values_supported');
    expect(mcpProtectedResourceMetadata().authorization_servers).toEqual([metadata.issuer]);
    await expect(getAuthorizationServerMetadata().json()).resolves.toEqual(metadata);
  });

  it('returns only safe authorization errors, exact state, and issuer to a trusted callback', () => {
    vi.stubEnv('AUTH_URL', 'https://timeline.example');
    const destination = oauthAuthorizationErrorRedirect(
      new McpOAuthError('invalid_scope', 'sensitive internal validation detail', {
        redirectUri: 'https://client.example/callback?existing=1',
        state: 'exact-state-value',
      }),
    );

    const url = new URL(String(destination));
    expect(url.origin + url.pathname).toBe('https://client.example/callback');
    expect(url.searchParams.get('existing')).toBe('1');
    expect(url.searchParams.get('error')).toBe('invalid_scope');
    expect(url.searchParams.get('error_description')).toBe(
      'The requested scope is invalid or unsupported.',
    );
    expect(url.searchParams.get('error_description')).not.toContain('sensitive');
    expect(url.searchParams.get('state')).toBe('exact-state-value');
    expect(url.searchParams.get('iss')).toBe('https://timeline.example');

    expect(
      oauthAuthorizationErrorRedirect(
        new McpOAuthError('invalid_redirect_uri', 'Unregistered callback'),
      ),
    ).toBeNull();
  });
});
