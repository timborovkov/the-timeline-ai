import { createHash } from 'node:crypto';

import {
  auditLog,
  mcpOutboundKeys,
  mcpOutboundOAuthClients,
  mcpOutboundOAuthCodes,
  mcpOutboundOAuthGrants,
  mcpOutboundOAuthTokens,
  teamMembers,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashKey } from '#src/mcp-server/keys.js';
import { REVOKED_GRANT_RETENTION_MS } from '#src/mcp-server/oauth-core.js';
import {
  createMcpAuthorizationCode,
  exchangeMcpAuthorizationCode,
  McpOAuthError,
  MCP_TEAM_ACTOR_USER_ID,
  parseMcpOAuthScopes,
  registerMcpOAuthClient,
  revokeMcpOAuthToken,
  resolveMcpBearer as resolveTimelineMcpBearer,
  rotateMcpRefreshToken,
  validateMcpAuthorizationRequest,
} from '#src/mcp-server/oauth.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESOURCE = 'https://thetimeline.cc/api/mcp/server';
const REDIRECT_URI = 'https://client.example/oauth/callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const SECOND_VERIFIER = 'w'.repeat(64);
const SECOND_CHALLENGE = createHash('sha256').update(SECOND_VERIFIER).digest('base64url');
const STATIC_TOKEN = 'tla_static_compatibility_token_for_oauth_tests';

function resolveMcpBearer(db: Db, token: string, expectedResource = RESOURCE) {
  return resolveTimelineMcpBearer(db, token, expectedResource);
}

async function seedWorkspace(testDb: ResettablePGliteTestDb): Promise<void> {
  await testDb.pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES
      ('${TEAM_ID}', 'oauth-team', 'OAuth Team'),
      ('${OTHER_TEAM_ID}', 'other-oauth-team', 'Other OAuth Team');
    INSERT INTO users (id, email, name)
    VALUES
      ('${USER_ID}', 'owner@example.test', 'OAuth Owner'),
      ('${OTHER_USER_ID}', 'other-owner@example.test', 'Other OAuth Owner');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES
      ('${TEAM_ID}', '${USER_ID}', 'owner'),
      ('${OTHER_TEAM_ID}', '${OTHER_USER_ID}', 'owner');
  `);
}

async function createDcrAuthorization(db: Db, scope = 'read agent:ask') {
  const client = await registerMcpOAuthClient(db, {
    client_name: 'Test MCP client',
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  const request = await validateMcpAuthorizationRequest(
    db,
    {
      responseType: 'code',
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      scope,
      state: 'client-state',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    },
    RESOURCE,
  );
  return { client, request };
}

describe('Timeline MCP OAuth server', () => {
  let testDb: ResettablePGliteTestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createResettablePGliteTestDb();
    db = drizzle(testDb.pg) as unknown as Db;
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    await testDb.reset();
    await seedWorkspace(testDb);
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('issues one-use PKCE tokens for a real user principal and audits consent', async () => {
    const { client, request } = await createDcrAuthorization(db);
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const tokens = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });

    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3_600,
      scope: 'read agent:ask',
      resource: RESOURCE,
    });
    const principal = await resolveMcpBearer(db, tokens.access_token);
    expect(principal).toMatchObject({
      authType: 'oauth',
      teamId: TEAM_ID,
      userId: USER_ID,
      clientId: client.client_id,
      scopes: ['read', 'agent:ask'],
    });
    await expect(
      exchangeMcpAuthorizationCode(db, {
        code,
        clientId: client.client_id,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    const events = await db.select().from(auditLog).where(eq(auditLog.teamId, TEAM_ID));
    expect(events).toEqual([
      expect.objectContaining({
        actorUserId: USER_ID,
        action: 'mcp.oauth_connect',
        targetType: 'mcp_oauth_grant',
      }),
    ]);
  });

  it('keeps team-known consent, grant inspection, authorization, and revocation behind scope.mcpOAuth', async () => {
    const { request } = await createDcrAuthorization(db, 'read');
    const scope = withTeam(db, TEAM_ID, USER_ID).mcpOAuth;
    await scope.createAuthorizationCode(request);

    const grants = await scope.listGrants();
    expect(grants).toHaveLength(1);
    const grantId = grants[0]?.id;
    if (!grantId) throw new Error('expected OAuth grant');
    await expect(
      scope.authorizeCurrentGrant({
        grantId,
        expectedScopes: ['read'],
        expectedResource: RESOURCE,
      }),
    ).resolves.toBe(true);

    await expect(scope.revokeGrant(grantId)).resolves.toBe(true);
    await expect(scope.listGrants()).resolves.toEqual([]);
    await expect(
      scope.authorizeCurrentGrant({
        grantId,
        expectedScopes: ['read'],
        expectedResource: RESOURCE,
      }),
    ).resolves.toBe(false);
  });

  it('prunes OAuth records only after their security windows in the exact system team scope', async () => {
    const now = Date.now();
    const expiredAt = new Date(now - 60_000);
    const liveUntil = new Date(now + 60 * 60 * 1_000);
    const oldRevokedAt = new Date(now - REVOKED_GRANT_RETENTION_MS - 60_000);
    const recentlyRevokedAt = new Date(now - 60_000);
    const grants = {
      old: '10000000-0000-4000-8000-000000000001',
      recent: '10000000-0000-4000-8000-000000000002',
      active: '10000000-0000-4000-8000-000000000003',
      otherTeam: '10000000-0000-4000-8000-000000000004',
    };
    const clients = {
      old: 'retention-old-client',
      recent: 'retention-recent-client',
      active: 'retention-active-client',
      otherTeam: 'retention-other-team-client',
    };
    await db.insert(mcpOutboundOAuthClients).values(
      Object.values(clients).map((clientId) => ({
        clientId,
        clientName: clientId,
        redirectUris: [REDIRECT_URI],
      })),
    );
    await db.insert(mcpOutboundOAuthGrants).values([
      {
        id: grants.old,
        clientId: clients.old,
        teamId: TEAM_ID,
        userId: USER_ID,
        membershipAuthorizationEpoch: '30000000-0000-4000-8000-000000000001',
        scopes: ['read'],
        resource: RESOURCE,
        revokedAt: oldRevokedAt,
      },
      {
        id: grants.recent,
        clientId: clients.recent,
        teamId: TEAM_ID,
        userId: USER_ID,
        membershipAuthorizationEpoch: '30000000-0000-4000-8000-000000000002',
        scopes: ['read'],
        resource: RESOURCE,
        revokedAt: recentlyRevokedAt,
      },
      {
        id: grants.active,
        clientId: clients.active,
        teamId: TEAM_ID,
        userId: USER_ID,
        membershipAuthorizationEpoch: '30000000-0000-4000-8000-000000000003',
        scopes: ['read'],
        resource: RESOURCE,
      },
      {
        id: grants.otherTeam,
        clientId: clients.otherTeam,
        teamId: OTHER_TEAM_ID,
        userId: OTHER_USER_ID,
        membershipAuthorizationEpoch: '30000000-0000-4000-8000-000000000004',
        scopes: ['read'],
        resource: RESOURCE,
        revokedAt: oldRevokedAt,
      },
    ]);
    await db.insert(mcpOutboundOAuthCodes).values([
      {
        grantId: grants.old,
        clientId: clients.old,
        codeHash: 'expired-old-code',
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        scopes: ['read'],
        resource: RESOURCE,
        expiresAt: expiredAt,
      },
      {
        grantId: grants.recent,
        clientId: clients.recent,
        codeHash: 'live-recent-code',
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        scopes: ['read'],
        resource: RESOURCE,
        expiresAt: liveUntil,
      },
      {
        grantId: grants.active,
        clientId: clients.active,
        codeHash: 'expired-active-code',
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        scopes: ['read'],
        resource: RESOURCE,
        expiresAt: expiredAt,
      },
      {
        grantId: grants.otherTeam,
        clientId: clients.otherTeam,
        codeHash: 'expired-other-team-code',
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        scopes: ['read'],
        resource: RESOURCE,
        expiresAt: expiredAt,
      },
    ]);
    await db.insert(mcpOutboundOAuthTokens).values([
      {
        grantId: grants.old,
        accessTokenHash: 'expired-old-access',
        accessTokenPrefix: 'expired-old',
        accessExpiresAt: expiredAt,
        refreshTokenHash: 'expired-old-refresh',
        refreshTokenPrefix: 'expired-old',
        refreshExpiresAt: expiredAt,
      },
      {
        grantId: grants.recent,
        accessTokenHash: 'rotated-live-access',
        accessTokenPrefix: 'rotated-live',
        accessExpiresAt: expiredAt,
        refreshTokenHash: 'rotated-live-refresh',
        refreshTokenPrefix: 'rotated-live',
        refreshExpiresAt: liveUntil,
        rotatedAt: recentlyRevokedAt,
        revokedAt: recentlyRevokedAt,
      },
      {
        grantId: grants.active,
        accessTokenHash: 'expired-active-access',
        accessTokenPrefix: 'expired-active',
        accessExpiresAt: expiredAt,
        refreshTokenHash: 'expired-active-refresh',
        refreshTokenPrefix: 'expired-active',
        refreshExpiresAt: expiredAt,
      },
      {
        grantId: grants.otherTeam,
        accessTokenHash: 'expired-other-access',
        accessTokenPrefix: 'expired-other',
        accessExpiresAt: expiredAt,
        refreshTokenHash: 'expired-other-refresh',
        refreshTokenPrefix: 'expired-other',
        refreshExpiresAt: expiredAt,
      },
    ]);

    await expect(withTeam(db, TEAM_ID, USER_ID).mcpOAuth.pruneExpiredCredentials()).rejects.toThrow(
      'requires the system actor',
    );
    await expect(
      withTeam(db, TEAM_ID, MCP_TEAM_ACTOR_USER_ID, {
        skipMembershipCheck: true,
      }).mcpOAuth.pruneExpiredCredentials(),
    ).resolves.toEqual({
      authorizationCodesDeleted: 2,
      tokensDeleted: 2,
      grantsDeleted: 1,
    });

    const remainingCodes = await db.select().from(mcpOutboundOAuthCodes);
    expect(remainingCodes.map((row) => row.codeHash).sort()).toEqual([
      'expired-other-team-code',
      'live-recent-code',
    ]);
    const remainingTokens = await db.select().from(mcpOutboundOAuthTokens);
    expect(remainingTokens.map((row) => row.refreshTokenHash).sort()).toEqual([
      'expired-other-refresh',
      'rotated-live-refresh',
    ]);
    const remainingGrants = await db.select().from(mcpOutboundOAuthGrants);
    expect(remainingGrants.map((row) => row.id).sort()).toEqual(
      [grants.active, grants.otherTeam, grants.recent].sort(),
    );
  });

  it('binds OAuth access tokens to the canonical MCP resource', async () => {
    const { client, request } = await createDcrAuthorization(db, 'read');
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const tokens = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });

    await expect(resolveMcpBearer(db, tokens.access_token)).resolves.toMatchObject({
      teamId: TEAM_ID,
    });
    await expect(
      resolveMcpBearer(db, tokens.access_token, 'https://other.example/api/mcp/server'),
    ).resolves.toBeNull();
  });

  it('rotates refresh tokens and revokes the grant when an old token is replayed', async () => {
    const { client, request } = await createDcrAuthorization(db, 'read');
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const first = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    const second = await rotateMcpRefreshToken(db, {
      refreshToken: first.refresh_token,
      clientId: client.client_id,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await resolveMcpBearer(db, second.access_token)).toMatchObject({ userId: USER_ID });

    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: first.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await resolveMcpBearer(db, second.access_token)).toBeNull();
    const securityEvents = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'mcp.oauth_refresh_reuse'));
    expect(securityEvents).toEqual([{ action: 'mcp.oauth_refresh_reuse' }]);
  });

  it('allows refresh scope narrowing and rejects expansion or unknown scopes', async () => {
    const { client, request } = await createDcrAuthorization(db);
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const first = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });

    const narrowed = await rotateMcpRefreshToken(db, {
      refreshToken: first.refresh_token,
      clientId: client.client_id,
      resource: RESOURCE,
      expectedResource: RESOURCE,
      scope: 'read',
    });
    expect(narrowed.scope).toBe('read');
    await expect(resolveMcpBearer(db, first.access_token)).resolves.toBeNull();
    await expect(resolveMcpBearer(db, narrowed.access_token)).resolves.toMatchObject({
      scopes: ['read'],
    });

    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: narrowed.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
        scope: 'read agent:ask',
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' });
    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: narrowed.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
        scope: 'read unknown',
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' });

    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: first.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(resolveMcpBearer(db, narrowed.access_token)).resolves.toBeNull();
    const securityEvents = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.action, 'mcp.oauth_refresh_reuse'));
    expect(securityEvents).toEqual([{ action: 'mcp.oauth_refresh_reuse' }]);
  });

  it('isolates newly reauthorized credentials from rotated refresh tokens in the old family', async () => {
    const { client, request } = await createDcrAuthorization(db, 'read');
    const firstCode = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const first = await exchangeMcpAuthorizationCode(db, {
      code: firstCode,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    const rotated = await rotateMcpRefreshToken(db, {
      refreshToken: first.refresh_token,
      clientId: client.client_id,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    await revokeMcpOAuthToken(db, rotated.refresh_token);

    const reauthorizationCode = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const reauthorized = await exchangeMcpAuthorizationCode(db, {
      code: reauthorizationCode,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });

    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: first.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await resolveMcpBearer(db, reauthorized.access_token)).toMatchObject({
      userId: USER_ID,
    });
  });

  it('keeps OAuth credentials invalid after membership removal and reactivation', async () => {
    const { client, request } = await createDcrAuthorization(db, 'read');
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const tokens = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    await db
      .update(teamMembers)
      .set({ removedAt: new Date() })
      .where(eq(teamMembers.userId, USER_ID));

    expect(await resolveMcpBearer(db, tokens.access_token)).toBeNull();
    await db.update(teamMembers).set({ removedAt: null }).where(eq(teamMembers.userId, USER_ID));

    expect(await resolveMcpBearer(db, tokens.access_token)).toBeNull();
    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: tokens.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('requires an owner or admin and keeps agent credentials invalid after role restoration', async () => {
    await testDb.pg.exec(`
      INSERT INTO users (id, email, name)
      VALUES ('${MEMBER_ID}', 'member@example.test', 'OAuth Member');
      INSERT INTO team_members (team_id, user_id, role)
      VALUES ('${TEAM_ID}', '${MEMBER_ID}', 'member');
    `);
    const { client, request } = await createDcrAuthorization(db);
    await expect(
      createMcpAuthorizationCode(db, { request, userId: MEMBER_ID, teamId: TEAM_ID }),
    ).rejects.toMatchObject({ code: 'access_denied' });

    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const tokens = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });
    await db.update(teamMembers).set({ role: 'member' }).where(eq(teamMembers.userId, USER_ID));

    expect(await resolveMcpBearer(db, tokens.access_token)).toBeNull();
    await db.update(teamMembers).set({ role: 'owner' }).where(eq(teamMembers.userId, USER_ID));

    expect(await resolveMcpBearer(db, tokens.access_token)).toBeNull();
    await expect(
      rotateMcpRefreshToken(db, {
        refreshToken: tokens.refresh_token,
        clientId: client.client_id,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('invalidates an outstanding authorization code when the shared grant changes scope', async () => {
    const { client, request: readRequest } = await createDcrAuthorization(db, 'read');
    const readCode = await createMcpAuthorizationCode(db, {
      request: readRequest,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const agentRequest = await validateMcpAuthorizationRequest(
      db,
      {
        responseType: 'code',
        clientId: client.client_id,
        redirectUri: REDIRECT_URI,
        scope: 'read agent:ask',
        state: 'agent-state',
        codeChallenge: SECOND_CHALLENGE,
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      },
      RESOURCE,
    );
    const agentCode = await createMcpAuthorizationCode(db, {
      request: agentRequest,
      userId: USER_ID,
      teamId: TEAM_ID,
    });

    await expect(
      exchangeMcpAuthorizationCode(db, {
        code: readCode,
        clientId: client.client_id,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(
      exchangeMcpAuthorizationCode(db, {
        code: agentCode,
        clientId: client.client_id,
        redirectUri: REDIRECT_URI,
        codeVerifier: SECOND_VERIFIER,
        resource: RESOURCE,
        expectedResource: RESOURCE,
      }),
    ).resolves.toMatchObject({ scope: 'read agent:ask' });
  });

  it('attributes public token revocation to the client rather than the consenting user', async () => {
    const { client, request } = await createDcrAuthorization(db, 'read');
    const code = await createMcpAuthorizationCode(db, {
      request,
      userId: USER_ID,
      teamId: TEAM_ID,
    });
    const tokens = await exchangeMcpAuthorizationCode(db, {
      code,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource: RESOURCE,
      expectedResource: RESOURCE,
    });

    await revokeMcpOAuthToken(db, tokens.refresh_token);

    const events = await db
      .select({
        actorUserId: auditLog.actorUserId,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(eq(auditLog.action, 'mcp.oauth_disconnect'));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorUserId).toBeNull();
    expect(events[0]?.metadata).toMatchObject({
      client_id: client.client_id,
      authorizing_user_id: USER_ID,
      source: 'oauth_revocation_endpoint',
    });
  });

  it('resolves a current CIMD client through a bounded metadata fetch', async () => {
    const clientId = 'https://client.example/.well-known/oauth-client';
    const fetchClientMetadata = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: 'CIMD Client',
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
            token_endpoint_auth_method: 'private_key_jwt',
            grant_types: ['authorization_code'],
            response_types: ['code'],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const request = await validateMcpAuthorizationRequest(
      db,
      {
        responseType: 'code',
        clientId,
        redirectUri: REDIRECT_URI,
        scope: 'read',
        state: 'state',
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        resource: RESOURCE,
      },
      RESOURCE,
      { fetchClientMetadata },
    );

    expect(request.client).toMatchObject({ clientId, clientName: 'CIMD Client' });
    expect(fetchClientMetadata).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({ redirect: 'manual' }),
      { maxResponseBytes: 65_536, timeoutMs: 5_000 },
    );
    const stored = await db
      .select({ clientName: mcpOutboundOAuthClients.clientName })
      .from(mcpOutboundOAuthClients)
      .where(eq(mcpOutboundOAuthClients.clientId, clientId));
    expect(stored).toEqual([{ clientName: 'CIMD Client' }]);
  });

  it('attaches the exact registered callback only after client and redirect validation', async () => {
    const client = await registerMcpOAuthClient(db, {
      client_name: 'Authorization error client',
      redirect_uris: [REDIRECT_URI],
    });
    const baseInput = {
      responseType: 'code',
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      scope: 'read',
      state: 'exact-client-state',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    };

    for (const testCase of [
      { input: { ...baseInput, responseType: 'token' }, code: 'unsupported_response_type' },
      { input: { ...baseInput, scope: 'read unknown' }, code: 'invalid_scope' },
      {
        input: { ...baseInput, resource: 'https://other.example/api/mcp/server' },
        code: 'invalid_target',
      },
    ] as const) {
      await expect(
        validateMcpAuthorizationRequest(db, testCase.input, RESOURCE),
      ).rejects.toMatchObject({
        code: testCase.code,
        trustedAuthorizationRedirect: {
          redirectUri: REDIRECT_URI,
          state: 'exact-client-state',
        },
      });
    }

    let invalidRedirectError: unknown;
    try {
      await validateMcpAuthorizationRequest(
        db,
        {
          ...baseInput,
          responseType: 'token',
          redirectUri: 'https://attacker.example/callback',
        },
        RESOURCE,
      );
    } catch (error) {
      invalidRedirectError = error;
    }
    expect(invalidRedirectError).toBeInstanceOf(McpOAuthError);
    expect(invalidRedirectError).toMatchObject({ code: 'invalid_redirect_uri' });
    expect((invalidRedirectError as McpOAuthError).trustedAuthorizationRedirect).toBeUndefined();
  });

  it('accepts only an exact unpadded SHA-256 base64url PKCE challenge', async () => {
    const client = await registerMcpOAuthClient(db, {
      client_name: 'PKCE validation client',
      redirect_uris: [REDIRECT_URI],
    });
    const baseInput = {
      responseType: 'code',
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      scope: 'read',
      state: 'pkce-state',
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    };

    await expect(
      validateMcpAuthorizationRequest(
        db,
        { ...baseInput, codeChallenge: 'x'.repeat(128) },
        RESOURCE,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      validateMcpAuthorizationRequest(
        db,
        { ...baseInput, codeChallenge: '.'.repeat(43) },
        RESOURCE,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      validateMcpAuthorizationRequest(db, { ...baseInput, codeChallenge: CHALLENGE }, RESOURCE),
    ).resolves.toMatchObject({ codeChallenge: CHALLENGE });
  });

  it('rejects unsafe or mismatched client metadata and incomplete scope sets', async () => {
    expect(() => parseMcpOAuthScopes('agent:ask')).toThrow(McpOAuthError);
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      validateMcpAuthorizationRequest(
        db,
        {
          responseType: 'code',
          clientId: 'https://127.0.0.1/client.json',
          redirectUri: REDIRECT_URI,
          scope: 'read',
          state: 'state',
          codeChallenge: CHALLENGE,
          codeChallengeMethod: 'S256',
          resource: RESOURCE,
        },
        RESOURCE,
        {
          fetchClientMetadata: () =>
            Promise.resolve(
              new Response('{}', { headers: { 'content-type': 'application/json' } }),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });

    const clientId = 'https://client.example/client.json';
    await expect(
      validateMcpAuthorizationRequest(
        db,
        {
          responseType: 'code',
          clientId,
          redirectUri: REDIRECT_URI,
          scope: 'read',
          state: 'state',
          codeChallenge: CHALLENGE,
          codeChallengeMethod: 'S256',
          resource: RESOURCE,
        },
        RESOURCE,
        {
          fetchClientMetadata: () =>
            Promise.resolve(
              new Response(
                JSON.stringify({
                  client_id: 'https://attacker.example/client.json',
                  client_name: 'Mismatch',
                  redirect_uris: [REDIRECT_URI],
                }),
                { headers: { 'content-type': 'application/json' } },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('keeps static team keys on the team-only pseudo-user path', async () => {
    await db.insert(mcpOutboundKeys).values({
      teamId: TEAM_ID,
      createdByUserId: USER_ID,
      name: 'Static compatibility key',
      keyHash: hashKey(STATIC_TOKEN),
      keyPrefix: STATIC_TOKEN.slice(0, 12),
      scopes: ['read'],
    });

    expect(await resolveMcpBearer(db, STATIC_TOKEN)).toMatchObject({
      authType: 'api_key',
      teamId: TEAM_ID,
      userId: MCP_TEAM_ACTOR_USER_ID,
      clientId: 'timeline-static-key',
      scopes: ['read'],
    });
  });
});
