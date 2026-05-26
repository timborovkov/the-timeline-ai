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

import { eventVisibility } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

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
    enabled: boolean('enabled').notNull().default(true),
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('integrations_team_provider_idx').on(table.teamId, table.provider),
    uniqueIndex('integrations_team_provider_account_unq')
      .on(table.teamId, table.provider, table.externalAccountId)
      .where(sql`${table.externalAccountId} IS NOT NULL`),
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
