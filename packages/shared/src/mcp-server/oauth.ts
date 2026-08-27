import type { ValidatedAuthorizationRequest } from '#src/mcp-server/oauth-core.js';
import type { Db } from '@timeline/db';

import { withTeam } from '#src/team-scope.js';

export {
  McpOAuthError,
  MCP_OAUTH_DEFAULT_SCOPE,
  MCP_OAUTH_SCOPES,
  MCP_TEAM_ACTOR_USER_ID,
  normalizeMcpResource,
  parseMcpOAuthScopes,
  type McpAuthPrincipal,
  type McpOAuthErrorCode,
  type McpOAuthScope,
  type OAuthTokenResponse,
  type RegisteredOAuthClient,
  type ValidatedAuthorizationRequest,
  withMcpOAuthTrustedAuthorizationRedirect,
} from '#src/mcp-server/oauth-core.js';
export {
  exchangeMcpAuthorizationCode,
  registerMcpOAuthClient,
  resolveMcpBearer,
  resolveMcpOAuthClient,
  revokeMcpOAuthToken,
  rotateMcpRefreshToken,
  validateMcpAuthorizationRequest,
  type McpOAuthClientResolutionDeps,
} from '#src/mcp-server/oauth-pre-principal.js';

/** Compatibility adapter for signed-in consent callers. */
export function createMcpAuthorizationCode(
  db: Db,
  input: {
    request: ValidatedAuthorizationRequest;
    userId: string;
    teamId: string;
  },
): Promise<string> {
  return withTeam(db, input.teamId, input.userId).mcpOAuth.createAuthorizationCode(input.request);
}

/** Compatibility adapter for signed-in grant revocation callers. */
export function revokeMcpOAuthGrant(
  db: Db,
  input: { grantId: string; userId: string; teamId: string },
): Promise<boolean> {
  return withTeam(db, input.teamId, input.userId).mcpOAuth.revokeGrant(input.grantId);
}

/** Compatibility adapter for signed-in grant listing callers. */
export function listMcpOAuthGrants(db: Db, userId: string, teamId: string) {
  return withTeam(db, teamId, userId).mcpOAuth.listGrants();
}
