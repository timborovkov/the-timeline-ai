import { mcpAuthorizationServerMetadata, oauthMetadataResponse } from '@/lib/mcp-oauth-server';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return oauthMetadataResponse(mcpAuthorizationServerMetadata());
}
