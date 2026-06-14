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

import { eventVisibility } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Phase 11 — Third-party integrations.
//
// One row per connected external account (e.g. one Drive workspace, one
// Linear org, one GitHub installation, or one custom MCP server). All
// auth material is AES-256-GCM encrypted at rest via
// `packages/shared/src/crypto/secrets.ts` — `auth_secret_ciphertext`,
// `auth_secret_iv`, and `auth_secret_tag` together form one
// `EncryptedSecret`.

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const integrationProvider = pgEnum('integration_provider', [
  'google_drive',
  'linear',
  'github',
  'mcp',
]);

export const connectionAttentionCategory = pgEnum('connection_attention_category', [
  'needs_reconnect',
  'needs_new_owner',
  'access_changed',
  'sync_error',
]);

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: integrationProvider('provider').notNull(),
    displayName: text('display_name').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    scopes: text('scopes').array(),
    authSecretCiphertext: bytea('auth_secret_ciphertext').notNull(),
    authSecretIv: bytea('auth_secret_iv').notNull(),
    authSecretTag: bytea('auth_secret_tag').notNull(),
    lastError: text('last_error'),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('provider_connections_owner_idx').on(table.ownerUserId),
    uniqueIndex('provider_connections_owner_provider_account_unq').on(
      table.ownerUserId,
      table.provider,
      table.externalAccountId,
    ),
  ],
);

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    provider: integrationProvider('provider').notNull(),
    displayName: text('display_name').notNull(),
    /**
     * Provider-issued account identifier (Google sub, Linear org id,
     * GitHub installation id, MCP server URL). Drives the per-team
     * uniqueness check that prevents the same external account from
     * being connected twice. Nullable for providers that don't surface
     * one until after first sync.
     */
    externalAccountId: text('external_account_id'),
    scopes: text('scopes').array(),
    /** Encrypted refresh + access tokens JSON. Null for custom MCP entries — those store auth on `mcp_servers` instead. */
    authSecretCiphertext: bytea('auth_secret_ciphertext'),
    authSecretIv: bytea('auth_secret_iv'),
    authSecretTag: bytea('auth_secret_tag'),
    visibilityDefault: eventVisibility('visibility_default').notNull().default('team'),
    visibilityDefaultUserIds: uuid('visibility_default_user_ids').array(),
    enabled: boolean('enabled').notNull().default(true),
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('integrations_team_provider_idx').on(table.teamId, table.provider),
    index('integrations_provider_connection_idx').on(table.providerConnectionId),
    uniqueIndex('integrations_team_provider_account_unq')
      .on(table.teamId, table.provider, table.externalAccountId)
      .where(sql`${table.externalAccountId} IS NOT NULL`),
  ],
);

export const teamProviderResourceShares = pgTable(
  'team_provider_resource_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    resourceKind: text('resource_kind').notNull(),
    externalId: text('external_id').notNull(),
    externalLabel: text('external_label'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('team_provider_resource_shares_team_idx').on(table.teamId),
    index('team_provider_resource_shares_connection_idx').on(table.providerConnectionId),
    uniqueIndex('team_provider_resource_shares_unq').on(
      table.teamId,
      table.providerConnectionId,
      table.resourceKind,
      table.externalId,
    ),
  ],
);

// Per-resource sync cursor. Each integration has many resource types
// (drive.files, drive.changes, linear.issues, github.prs, …) and each
// keeps its own delta cursor so a partial failure on one type doesn't
// reset the others.
export const integrationSyncState = pgTable(
  'integration_sync_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    cursor: jsonb('cursor').notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_sync_state_resource_unq').on(table.integrationId, table.resourceType),
  ],
);

// User-selected resources to sync (folders, projects, repos). The team
// admin picks these from the settings UI after connecting.
export const integrationSelections = pgTable(
  'integration_selections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    resourceShareId: uuid('resource_share_id').references(() => teamProviderResourceShares.id, {
      onDelete: 'set null',
    }),
    selectionKind: text('selection_kind').notNull(),
    externalId: text('external_id').notNull(),
    externalLabel: text('external_label'),
    visibility: eventVisibility('visibility').notNull().default('team'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_selections_unq').on(
      table.integrationId,
      table.selectionKind,
      table.externalId,
    ),
    index('integration_selections_integration_idx').on(table.integrationId),
    index('integration_selections_share_idx').on(table.resourceShareId),
  ],
);

export const connectionAttention = pgTable(
  'connection_attention',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'cascade',
    }),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'cascade',
    }),
    resourceShareId: uuid('resource_share_id').references(() => teamProviderResourceShares.id, {
      onDelete: 'cascade',
    }),
    category: connectionAttentionCategory('category').notNull(),
    summary: text('summary').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    lastEmailedAt: timestamp('last_emailed_at', { withTimezone: true }),
  },
  (table) => [
    index('connection_attention_team_idx').on(table.teamId),
    index('connection_attention_provider_connection_idx').on(table.providerConnectionId),
    index('connection_attention_integration_idx').on(table.integrationId),
    index('connection_attention_resource_share_idx').on(table.resourceShareId),
  ],
);

// Append-only audit log of integration activity (connect, sync results,
// errors, replays). Surfaced in the settings audit view.
export const integrationAuditLog = pgTable(
  'integration_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'cascade',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('integration_audit_team_created_idx').on(table.teamId, table.createdAt),
    index('integration_audit_integration_idx').on(table.integrationId),
  ],
);
