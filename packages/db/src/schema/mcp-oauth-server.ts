import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

/**
 * OAuth public clients registered by ChatGPT, Claude, Codex, and other MCP
 * hosts. Timeline supports public clients with PKCE, so client secrets are
 * deliberately not stored or issued.
 */
export const mcpOutboundOAuthClients = pgTable(
  'mcp_outbound_oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    clientName: text('client_name').notNull(),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
    clientUri: text('client_uri'),
    logoUri: text('logo_uri'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
    grantTypes: jsonb('grant_types')
      .$type<string[]>()
      .notNull()
      .default(['authorization_code', 'refresh_token']),
    responseTypes: jsonb('response_types').$type<string[]>().notNull().default(['code']),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'mcp_outbound_oauth_clients_auth_method_chk',
      sql`${table.tokenEndpointAuthMethod} = 'none'`,
    ),
  ],
);

/** One revocable consent grant for a client, user, and team. */
export const mcpOutboundOAuthGrants = pgTable(
  'mcp_outbound_oauth_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpOutboundOAuthClients.clientId, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    membershipAuthorizationEpoch: uuid('membership_authorization_epoch').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    resource: text('resource').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mcp_outbound_oauth_grants_client_user_team_unq').on(
      table.clientId,
      table.userId,
      table.teamId,
    ),
    index('mcp_outbound_oauth_grants_user_team_idx').on(table.userId, table.teamId),
    index('mcp_outbound_oauth_grants_team_revoked_idx')
      .on(table.teamId, table.revokedAt)
      .where(sql`${table.revokedAt} IS NOT NULL`),
  ],
);

/** Short-lived, one-use authorization codes. Only SHA-256 digests persist. */
export const mcpOutboundOAuthCodes = pgTable(
  'mcp_outbound_oauth_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => mcpOutboundOAuthGrants.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpOutboundOAuthClients.clientId, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    resource: text('resource').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mcp_outbound_oauth_codes_hash_unq').on(table.codeHash),
    index('mcp_outbound_oauth_codes_grant_idx').on(table.grantId),
    index('mcp_outbound_oauth_codes_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Rotating OAuth token pairs. Access and refresh tokens are opaque and stored
 * only as SHA-256 digests. Reuse of a rotated refresh token revokes its grant.
 */
export const mcpOutboundOAuthTokens = pgTable(
  'mcp_outbound_oauth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => mcpOutboundOAuthGrants.id, { onDelete: 'cascade' }),
    accessTokenHash: text('access_token_hash').notNull(),
    accessTokenPrefix: text('access_token_prefix').notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    refreshTokenPrefix: text('refresh_token_prefix').notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mcp_outbound_oauth_tokens_access_hash_unq').on(table.accessTokenHash),
    uniqueIndex('mcp_outbound_oauth_tokens_refresh_hash_unq').on(table.refreshTokenHash),
    index('mcp_outbound_oauth_tokens_grant_idx').on(table.grantId),
    index('mcp_outbound_oauth_tokens_refresh_expires_idx').on(table.refreshExpiresAt),
  ],
);
