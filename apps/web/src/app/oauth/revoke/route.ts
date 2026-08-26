import { revokeMcpOAuthToken } from '@timeline/shared/mcp-server';

import { db } from '@/lib/db';
import {
  MCP_OAUTH_BODY_LIMIT_BYTES,
  mcpOAuthRateLimitResponse,
  oauthErrorResponse,
  oauthJsonResponse,
  requireFormContentType,
  singleFormValue,
} from '@/lib/mcp-oauth-server';
import { readCappedTextBody } from '@/lib/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const rateLimited = await mcpOAuthRateLimitResponse(request, 'revoke');
  if (rateLimited) return rateLimited;
  const body = await readCappedTextBody(request, MCP_OAUTH_BODY_LIMIT_BYTES);
  if (body.tooLarge) {
    return oauthJsonResponse(
      { error: 'invalid_request', error_description: 'Revocation request is too large' },
      413,
    );
  }
  const params = new URLSearchParams(body.text);
  const token = singleFormValue(params, 'token');
  if (!token) {
    return oauthJsonResponse(
      { error: 'invalid_request', error_description: 'A single token parameter is required' },
      400,
    );
  }
  try {
    await revokeMcpOAuthToken(db, token);
    return oauthJsonResponse({});
  } catch (error) {
    return oauthErrorResponse(error, 'Token revocation failed');
  }
}
