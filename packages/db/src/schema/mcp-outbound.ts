import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

/**
 * Phase 11 — Timeline-as-MCP-server bearer keys. Each row authorises one
 * external agent (Claude Desktop, Cursor, etc.) to talk to a
 * team's timeline via /api/mcp/server. We persist only the SHA-256 of
 * the key so a DB leak can't replay tokens; the one-time plaintext is
 * shown to the user at creation and never again.
 */
export const mcpOutboundKeys = pgTable(
  'mcp_outbound_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    /** SHA-256 hex of the plaintext key. */
    keyHash: text('key_hash').notNull(),
    /** Short prefix shown in the UI (e.g. `tla_a1b2c3…`). */
    keyPrefix: text('key_prefix').notNull(),
    /** JSON scopes: every key has `read`; explicit opt-in adds `agent:ask`. */
    scopes: jsonb('scopes').notNull().default(['read']),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mcp_outbound_keys_hash_unq').on(table.keyHash),
    index('mcp_outbound_keys_team_idx').on(table.teamId),
  ],
);
