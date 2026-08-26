import { timingSafeEqual } from 'node:crypto';

import {
  auditLog,
  type Db,
  mcpOutboundKeys,
  mcpOutboundOAuthClients,
  mcpOutboundOAuthCodes,
  mcpOutboundOAuthGrants,
  mcpOutboundOAuthTokens,
} from '@timeline/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { externalFetch } from '#src/http/external-fetch.js';
import { validateMcpUrl } from '#src/mcp/auth.js';
import { hashKey } from '#src/mcp-server/keys.js';
import {
  ACCESS_TOKEN_PREFIX,
  hashSecret,
  isValidPkceS256Challenge,
  McpOAuthError,
  type McpAuthPrincipal,
  MCP_TEAM_ACTOR_USER_ID,
  mintSecret,
  normalizeMcpResource,
  normalizeMetadataUrl,
  normalizeOptionalMetadataUri,
  normalizeRedirectUri,
  parseMcpOAuthScopes,
  type RegisteredOAuthClient,
  type ValidatedAuthorizationRequest,
  type OAuthTokenResponse,
  withMcpOAuthTrustedAuthorizationRedirect,
} from '#src/mcp-server/oauth-core.js';
import { withTeam } from '#src/team-scope.js';

const CLIENT_ID_PREFIX = 'tlc_';
const MAX_CLIENT_ID_LENGTH = 2_048;
const CIMD_MAX_RESPONSE_BYTES = 64 * 1_024;
const CIMD_TIMEOUT_MS = 5_000;

const clientRegistrationSchema = z
  .object({
    redirect_uris: z.array(z.string().max(2_048)).min(1).max(20),
    client_name: z.string().trim().min(1).max(100).optional(),
    client_uri: z.string().max(2_048).optional(),
    logo_uri: z.string().max(2_048).optional(),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).max(4).optional(),
    response_types: z.array(z.string()).max(4).optional(),
  })
  .loose();

const clientMetadataDocumentSchema = clientRegistrationSchema.extend({
  client_id: z.string().max(MAX_CLIENT_ID_LENGTH),
  client_name: z.string().trim().min(1).max(100),
  token_endpoint_auth_methods_supported: z.array(z.string()).min(1).max(8).optional(),
});

export interface McpOAuthClientResolutionDeps {
  fetchClientMetadata?: typeof externalFetch;
}

function validatePublicClientMetadata(input: {
  token_endpoint_auth_method?: string | undefined;
  token_endpoint_auth_methods_supported?: string[] | undefined;
  grant_types?: string[] | undefined;
  response_types?: string[] | undefined;
}): void {
  const authMethods = input.token_endpoint_auth_methods_supported;
  if (
    authMethods
      ? !authMethods.includes('none')
      : input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none'
  ) {
    throw new McpOAuthError(
      'invalid_client_metadata',
      'Timeline accepts public OAuth clients with token_endpoint_auth_method=none',
    );
  }
  const grantTypes = input.grant_types ?? ['authorization_code', 'refresh_token'];
  if (
    !grantTypes.includes('authorization_code') ||
    grantTypes.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')
  ) {
    throw new McpOAuthError('invalid_client_metadata', 'Unsupported OAuth grant type');
  }
  const responseTypes = input.response_types ?? ['code'];
  if (!responseTypes.includes('code') || responseTypes.some((response) => response !== 'code')) {
    throw new McpOAuthError('invalid_client_metadata', 'Unsupported OAuth response type');
  }
}

function normalizeCimdClientId(raw: string): string {
  const url = normalizeMetadataUrl(raw);
  if (url.protocol !== 'https:' || url.pathname === '/') {
    throw new McpOAuthError(
      'invalid_client',
      'A client metadata document client_id must be an HTTPS URL with a non-root path',
    );
  }
  const urlError = validateMcpUrl(url.toString());
  if (urlError) throw new McpOAuthError('invalid_client', 'Unsafe client metadata document URL');
  return url.toString();
}

function clientFromRow(row: typeof mcpOutboundOAuthClients.$inferSelect): RegisteredOAuthClient {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    clientUri: row.clientUri,
    logoUri: row.logoUri,
  };
}

/**
 * Auth seam exception: public client registration has no team or user
 * principal yet, so this global registry operation cannot use withTeam.
 */
export async function registerMcpOAuthClient(
  db: Db,
  raw: unknown,
): Promise<{
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none';
  grant_types: ['authorization_code', 'refresh_token'];
  response_types: ['code'];
}> {
  const parsed = clientRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new McpOAuthError('invalid_client_metadata', 'Invalid client registration metadata');
  }
  const input = parsed.data;
  validatePublicClientMetadata(input);
  const redirectUris = [...new Set(input.redirect_uris.map(normalizeRedirectUri))];
  const clientUri = normalizeOptionalMetadataUri(input.client_uri);
  const logoUri = normalizeOptionalMetadataUri(input.logo_uri);
  const clientId = mintSecret(CLIENT_ID_PREFIX, 24).plaintext;
  const now = new Date();
  await db.insert(mcpOutboundOAuthClients).values({
    clientId,
    clientName: input.client_name ?? 'MCP client',
    redirectUris,
    clientUri,
    logoUri,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    createdAt: now,
    updatedAt: now,
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1_000),
    client_name: input.client_name ?? 'MCP client',
    ...(clientUri ? { client_uri: clientUri } : {}),
    ...(logoUri ? { logo_uri: logoUri } : {}),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

/**
 * Resolve a public OAuth client before a team/user principal exists. Opaque
 * IDs are DCR records; HTTPS IDs are freshly validated CIMD documents.
 */
export async function resolveMcpOAuthClient(
  db: Db,
  clientId: string,
  deps: McpOAuthClientResolutionDeps = {},
): Promise<RegisteredOAuthClient> {
  if (clientId.startsWith('https://')) {
    const normalizedClientId = normalizeCimdClientId(clientId);
    let response: Response;
    try {
      response = await (deps.fetchClientMetadata ?? externalFetch)(
        normalizedClientId,
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'manual',
        },
        {
          maxResponseBytes: CIMD_MAX_RESPONSE_BYTES,
          timeoutMs: CIMD_TIMEOUT_MS,
        },
      );
    } catch {
      throw new McpOAuthError('invalid_client', 'Unable to load client metadata');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new McpOAuthError('invalid_client', 'Client metadata redirects are not allowed');
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      !response.ok ||
      (!contentType.includes('application/json') && !contentType.includes('+json'))
    ) {
      throw new McpOAuthError('invalid_client', 'Client metadata must be a JSON document');
    }
    let rawMetadata: unknown;
    try {
      rawMetadata = await response.json();
    } catch {
      throw new McpOAuthError('invalid_client', 'Client metadata is not valid JSON');
    }
    const parsed = clientMetadataDocumentSchema.safeParse(rawMetadata);
    if (!parsed.success || parsed.data.client_id !== normalizedClientId) {
      throw new McpOAuthError('invalid_client', 'Client metadata does not match client_id');
    }
    validatePublicClientMetadata(parsed.data);
    const redirectUris = [...new Set(parsed.data.redirect_uris.map(normalizeRedirectUri))];
    const clientUri = normalizeOptionalMetadataUri(parsed.data.client_uri);
    const logoUri = normalizeOptionalMetadataUri(parsed.data.logo_uri);
    const now = new Date();
    const values = {
      clientName: parsed.data.client_name,
      redirectUris,
      clientUri,
      logoUri,
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      updatedAt: now,
    };
    await db
      .insert(mcpOutboundOAuthClients)
      .values({ clientId: normalizedClientId, ...values, createdAt: now })
      .onConflictDoUpdate({
        target: mcpOutboundOAuthClients.clientId,
        set: values,
      });
    return {
      clientId: normalizedClientId,
      clientName: parsed.data.client_name,
      redirectUris,
      clientUri,
      logoUri,
    };
  }

  const rows = await db
    .select()
    .from(mcpOutboundOAuthClients)
    .where(eq(mcpOutboundOAuthClients.clientId, clientId))
    .limit(1);
  const client = rows[0];
  if (!client) throw new McpOAuthError('invalid_client', 'Unknown OAuth client');
  return clientFromRow(client);
}

export async function validateMcpAuthorizationRequest(
  db: Db,
  input: {
    responseType: string | null;
    clientId: string | null;
    redirectUri: string | null;
    scope: string | null;
    state: string | null;
    codeChallenge: string | null;
    codeChallengeMethod: string | null;
    resource: string | null;
  },
  expectedResource: string,
  deps: McpOAuthClientResolutionDeps = {},
): Promise<ValidatedAuthorizationRequest> {
  if (!input.clientId || input.clientId.length > MAX_CLIENT_ID_LENGTH) {
    throw new McpOAuthError('invalid_client', 'A valid client_id is required');
  }
  const client = await resolveMcpOAuthClient(db, input.clientId, deps);
  if (!input.redirectUri || input.redirectUri.length > 2_048) {
    throw new McpOAuthError('invalid_redirect_uri', 'A valid redirect_uri is required');
  }
  const redirectUri = normalizeRedirectUri(input.redirectUri);
  if (!client.redirectUris.includes(redirectUri)) {
    throw new McpOAuthError(
      'invalid_redirect_uri',
      'redirect_uri is not registered for this client',
    );
  }
  const trustedAuthorizationRedirect = {
    redirectUri,
    ...(input.state && input.state.length <= 2_048 ? { state: input.state } : {}),
  };

  try {
    if (input.responseType !== 'code') {
      throw new McpOAuthError('unsupported_response_type', 'Only response_type=code is supported');
    }
    if (!input.state || input.state.length > 2_048) {
      throw new McpOAuthError('invalid_request', 'A non-empty state parameter is required');
    }
    if (input.codeChallengeMethod !== 'S256' || !input.codeChallenge) {
      throw new McpOAuthError(
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required',
      );
    }
    if (!isValidPkceS256Challenge(input.codeChallenge)) {
      throw new McpOAuthError('invalid_request', 'Invalid PKCE code_challenge');
    }
    if (!input.resource) {
      throw new McpOAuthError('invalid_target', 'The resource parameter is required');
    }
    return {
      client: { ...client },
      redirectUri,
      scopes: parseMcpOAuthScopes(input.scope),
      state: input.state,
      codeChallenge: input.codeChallenge,
      resource: normalizeMcpResource(input.resource, expectedResource),
    };
  } catch (error) {
    throw withMcpOAuthTrustedAuthorizationRedirect(error, trustedAuthorizationRedirect);
  }
}

async function discoverAuthorizationCode(db: Db, codeHash: string) {
  const rows = await db
    .select({
      grantId: mcpOutboundOAuthCodes.grantId,
      teamId: mcpOutboundOAuthGrants.teamId,
      userId: mcpOutboundOAuthGrants.userId,
    })
    .from(mcpOutboundOAuthCodes)
    .innerJoin(mcpOutboundOAuthGrants, eq(mcpOutboundOAuthGrants.id, mcpOutboundOAuthCodes.grantId))
    .where(eq(mcpOutboundOAuthCodes.codeHash, codeHash))
    .limit(1);
  return rows[0] ?? null;
}

async function discoverRefreshToken(db: Db, refreshTokenHash: string) {
  const rows = await db
    .select({
      grantId: mcpOutboundOAuthTokens.grantId,
      teamId: mcpOutboundOAuthGrants.teamId,
      userId: mcpOutboundOAuthGrants.userId,
    })
    .from(mcpOutboundOAuthTokens)
    .innerJoin(
      mcpOutboundOAuthGrants,
      eq(mcpOutboundOAuthGrants.id, mcpOutboundOAuthTokens.grantId),
    )
    .where(eq(mcpOutboundOAuthTokens.refreshTokenHash, refreshTokenHash))
    .limit(1);
  return rows[0] ?? null;
}

async function discoverAccessToken(db: Db, accessTokenHash: string) {
  const rows = await db
    .select({
      grantId: mcpOutboundOAuthTokens.grantId,
      teamId: mcpOutboundOAuthGrants.teamId,
      userId: mcpOutboundOAuthGrants.userId,
    })
    .from(mcpOutboundOAuthTokens)
    .innerJoin(
      mcpOutboundOAuthGrants,
      eq(mcpOutboundOAuthGrants.id, mcpOutboundOAuthTokens.grantId),
    )
    .where(eq(mcpOutboundOAuthTokens.accessTokenHash, accessTokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function exchangeMcpAuthorizationCode(
  db: Db,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
    expectedResource: string;
  },
): Promise<OAuthTokenResponse> {
  const resource = normalizeMcpResource(input.resource, input.expectedResource);
  const redirectUri = normalizeRedirectUri(input.redirectUri);
  const codeHash = hashSecret(input.code);
  const discovered = await discoverAuthorizationCode(db, codeHash);
  if (!discovered) {
    throw new McpOAuthError('invalid_grant', 'Invalid, expired, or consumed authorization code');
  }
  return withTeam(db, discovered.teamId, discovered.userId).mcpOAuth.exchangeAuthorizationCode({
    codeHash,
    grantId: discovered.grantId,
    clientId: input.clientId,
    redirectUri,
    codeVerifier: input.codeVerifier,
    resource,
  });
}

export async function rotateMcpRefreshToken(
  db: Db,
  input: {
    refreshToken: string;
    clientId: string;
    resource: string;
    expectedResource: string;
    scope?: string | null;
  },
): Promise<OAuthTokenResponse> {
  const resource = normalizeMcpResource(input.resource, input.expectedResource);
  const requestedScopes =
    input.scope === null || input.scope === undefined
      ? undefined
      : parseMcpOAuthScopes(input.scope);
  const refreshTokenHash = hashSecret(input.refreshToken);
  const discovered = await discoverRefreshToken(db, refreshTokenHash);
  if (!discovered) throw new McpOAuthError('invalid_grant', 'Invalid or expired refresh token');
  return withTeam(db, discovered.teamId, discovered.userId).mcpOAuth.rotateRefreshToken({
    refreshTokenHash,
    grantId: discovered.grantId,
    clientId: input.clientId,
    resource,
    ...(requestedScopes ? { requestedScopes } : {}),
  });
}

/**
 * RFC 7009 token-possession revocation is intentionally pre-principal: the
 * opaque token is the proof, including after its user loses team membership.
 */
export async function revokeMcpOAuthToken(db: Db, token: string): Promise<void> {
  const hash = hashSecret(token);
  const rows = await db
    .select({
      grantId: mcpOutboundOAuthTokens.grantId,
      clientId: mcpOutboundOAuthGrants.clientId,
      teamId: mcpOutboundOAuthGrants.teamId,
      userId: mcpOutboundOAuthGrants.userId,
    })
    .from(mcpOutboundOAuthTokens)
    .innerJoin(
      mcpOutboundOAuthGrants,
      eq(mcpOutboundOAuthGrants.id, mcpOutboundOAuthTokens.grantId),
    )
    .where(
      or(
        eq(mcpOutboundOAuthTokens.accessTokenHash, hash),
        eq(mcpOutboundOAuthTokens.refreshTokenHash, hash),
      ),
    )
    .limit(1);
  const grant = rows[0];
  if (!grant) return;
  const now = new Date();
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx
      .update(mcpOutboundOAuthGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(mcpOutboundOAuthGrants.id, grant.grantId),
          eq(mcpOutboundOAuthGrants.teamId, grant.teamId),
          eq(mcpOutboundOAuthGrants.userId, grant.userId),
        ),
      );
    await tx
      .update(mcpOutboundOAuthTokens)
      .set({ revokedAt: now })
      .where(eq(mcpOutboundOAuthTokens.grantId, grant.grantId));
    await tx.insert(auditLog).values({
      teamId: grant.teamId,
      actorUserId: null,
      action: 'mcp.oauth_disconnect',
      targetType: 'mcp_oauth_grant',
      targetId: grant.grantId,
      metadata: {
        client_id: grant.clientId,
        authorizing_user_id: grant.userId,
        source: 'oauth_revocation_endpoint',
      },
    });
  });
}

async function resolveOAuthAccessToken(
  db: Db,
  token: string,
  expectedResource: string,
): Promise<McpAuthPrincipal | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const accessTokenHash = hashSecret(token);
  const discovered = await discoverAccessToken(db, accessTokenHash);
  if (!discovered) return null;
  return withTeam(db, discovered.teamId, discovered.userId).mcpOAuth.resolveAccessToken({
    accessTokenHash,
    grantId: discovered.grantId,
    expectedResource,
  });
}

/** Static bearer hash lookup is the same narrow pre-principal auth seam. */
async function resolveStaticBearerKey(db: Db, token: string): Promise<McpAuthPrincipal | null> {
  if (!token.startsWith('tla_')) return null;
  const hash = hashKey(token);
  const rows = await db
    .select()
    .from(mcpOutboundKeys)
    .where(and(eq(mcpOutboundKeys.keyHash, hash), isNull(mcpOutboundKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
  const actual = Buffer.from(row.keyHash, 'hex');
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  void db
    .update(mcpOutboundKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpOutboundKeys.id, row.id))
    .catch(() => undefined);
  return {
    authType: 'api_key',
    teamId: row.teamId,
    userId: MCP_TEAM_ACTOR_USER_ID,
    keyId: row.id,
    clientId: 'timeline-static-key',
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : ['read'],
    ...(row.expiresAt ? { expiresAt: Math.floor(row.expiresAt.getTime() / 1_000) } : {}),
  };
}

export async function resolveMcpBearer(
  db: Db,
  token: string,
  expectedResource: string,
): Promise<McpAuthPrincipal | null> {
  const oauth = await resolveOAuthAccessToken(db, token, expectedResource);
  if (oauth) return oauth;
  return resolveStaticBearerKey(db, token);
}
