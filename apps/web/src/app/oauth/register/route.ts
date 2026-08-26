import { registerMcpOAuthClient } from '@timeline/shared/mcp-server';

import { db } from '@/lib/db';
import {
  MCP_OAUTH_BODY_LIMIT_BYTES,
  mcpOAuthRateLimitResponse,
  oauthErrorResponse,
  oauthJsonResponse,
  requireJsonContentType,
} from '@/lib/mcp-oauth-server';
import { readCappedTextBody } from '@/lib/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  const rateLimited = await mcpOAuthRateLimitResponse(request, 'register');
  if (rateLimited) return rateLimited;
  const body = await readCappedTextBody(request, MCP_OAUTH_BODY_LIMIT_BYTES);
  if (body.tooLarge) {
    return oauthJsonResponse(
      { error: 'invalid_client_metadata', error_description: 'Client metadata is too large' },
      413,
    );
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(body.text);
  } catch {
    return oauthJsonResponse(
      { error: 'invalid_client_metadata', error_description: 'Client metadata is not valid JSON' },
      400,
    );
  }
  try {
    return oauthJsonResponse(await registerMcpOAuthClient(db, metadata), 201);
  } catch (error) {
    return oauthErrorResponse(error, 'Client registration failed');
  }
}
