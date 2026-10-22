import {
  exchangeMcpAuthorizationCode,
  McpOAuthError,
  rotateMcpRefreshToken,
} from '@timeline/shared/mcp-server';

import { db } from '@/lib/db';
import {
  MCP_OAUTH_BODY_LIMIT_BYTES,
  mcpOAuthRateLimitResponse,
  mcpOAuthResource,
  oauthErrorResponse,
  oauthJsonResponse,
  requireFormContentType,
  singleFormValue,
} from '@/lib/mcp-oauth-server';
import { readCappedTextBody } from '@/lib/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function required(params: URLSearchParams, name: string): string {
  const value = singleFormValue(params, name);
  if (!value) throw new McpOAuthError('invalid_request', `A single ${name} parameter is required`);
  return value;
}

export async function POST(request: Request): Promise<Response> {
  const contentTypeError = requireFormContentType(request);
  if (contentTypeError) return contentTypeError;
  if (request.headers.has('authorization')) {
    return oauthJsonResponse(
      {
        error: 'invalid_client',
        error_description: 'Timeline accepts public OAuth clients without client authentication',
      },
      401,
    );
  }
  const rateLimited = await mcpOAuthRateLimitResponse(request, 'token');
  if (rateLimited) return rateLimited;
  const body = await readCappedTextBody(request, MCP_OAUTH_BODY_LIMIT_BYTES);
  if (body.tooLarge) {
    return oauthJsonResponse(
      { error: 'invalid_request', error_description: 'Token request is too large' },
      413,
    );
  }

  try {
    const params = new URLSearchParams(body.text);
    if (params.has('client_secret')) {
      throw new McpOAuthError('invalid_client', 'Client secrets are not accepted');
    }
    const grantType = required(params, 'grant_type');
    const clientId = required(params, 'client_id');
    const resource = required(params, 'resource');
    const expectedResource = mcpOAuthResource();
    if (grantType === 'authorization_code') {
      return oauthJsonResponse(
        await exchangeMcpAuthorizationCode(db, {
          code: required(params, 'code'),
          clientId,
          redirectUri: required(params, 'redirect_uri'),
          codeVerifier: required(params, 'code_verifier'),
          resource,
          expectedResource,
        }),
      );
    }
    if (grantType === 'refresh_token') {
      const scopeValues = params.getAll('scope');
      if (scopeValues.length > 1) {
        throw new McpOAuthError('invalid_request', 'At most one scope parameter is allowed');
      }
      const requestedScope = scopeValues[0];
      return oauthJsonResponse(
        await rotateMcpRefreshToken(db, {
          refreshToken: required(params, 'refresh_token'),
          clientId,
          resource,
          expectedResource,
          ...(requestedScope === undefined ? {} : { scope: requestedScope }),
        }),
      );
    }
    throw new McpOAuthError('unsupported_grant_type', 'Unsupported OAuth grant type');
  } catch (error) {
    return oauthErrorResponse(error, 'Token request failed');
  }
}
