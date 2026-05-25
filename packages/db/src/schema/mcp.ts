import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// Phase 11 — Custom MCP servers per team. Mirrors Vernix's `mcpServers`
// shape but team-scoped: every server is owned by exactly one team and
// every member of that team can see the tools it exposes to the agent.
export const mcpAuthType = pgEnum('mcp_auth_type', [
  'none',
  'bearer',
  'header',
  'basic',
  'oauth',
  'url_key',
]);

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    // Phase 11 overlay: NULL == team-shared, visible to every member.
    // Non-NULL == personal, visible only to that user (still scoped to the
    // team so a user can have different personal MCPs per team).
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    authType: mcpAuthType('auth_type').notNull().default('none'),
    /**
     * Encrypted JSON describing the auth config for this server. Shape
     * varies by authType:
     *   - bearer: { token }
     *   - header: { name, value }
     *   - basic:  { username, password }
     *   - url_key: { paramName, value }
     *   - none / oauth: null
     * The plaintext never leaves the backend; the UI reads
     * `cachedTools` and `enabled` for display, not the secret.
     */
    authConfigCiphertext: bytea('auth_config_ciphertext'),
    authConfigIv: bytea('auth_config_iv'),
    authConfigTag: bytea('auth_config_tag'),
    enabled: boolean('enabled').notNull().default(true),
    disabledTools: jsonb('disabled_tools').notNull().default([]),
    cachedTools: jsonb('cached_tools'),
    toolsCachedAt: timestamp('tools_cached_at', { withTimezone: true }),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('mcp_servers_team_idx').on(table.teamId),
    // Team-shared rows (user_id IS NULL) keep the same constraint they
    // always had: one URL per team. Personal rows (user_id IS NOT NULL)
    // use the second partial unique so two users can each add their own
    // copy of the same URL without colliding.
    uniqueIndex('mcp_servers_team_url_unq')
      .on(table.teamId, table.url)
      .where(sql`${table.userId} IS NULL`),
    uniqueIndex('mcp_servers_team_user_url_unq')
      .on(table.teamId, table.userId, table.url)
      .where(sql`${table.userId} IS NOT NULL`),
    index('mcp_servers_user_idx')
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  ],
);

// OAuth tokens + dynamic-client metadata for MCP servers that speak the
// MCP SDK's OAuth flow. One row per (team, server) — every member of the
// team uses the same connection.
export const mcpOauthTokens = pgTable(
  'mcp_oauth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    mcpServerId: uuid('mcp_server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    /** Encrypted JSON: { accessToken, refreshToken?, tokenType, scope?, expiresAt? }. */
    tokenCiphertext: bytea('token_ciphertext').notNull(),
    tokenIv: bytea('token_iv').notNull(),
    tokenTag: bytea('token_tag').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Dynamic-client metadata (clientId/secret/issuance) for servers that issued one. Encrypted. */
    clientInfoCiphertext: bytea('client_info_ciphertext'),
    clientInfoIv: bytea('client_info_iv'),
    clientInfoTag: bytea('client_info_tag'),
    codeVerifier: text('code_verifier'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mcp_oauth_team_server_unq').on(table.teamId, table.mcpServerId),
    // Partial index unused today but reserves the shape for future
    // refresh queues that fire near `expires_at`.
    index('mcp_oauth_expires_idx')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  ],
);
