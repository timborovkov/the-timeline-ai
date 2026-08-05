import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
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
  'monday',
  'slack',
  'sentry',
  'mcp',
]);

export const connectionAttentionCategory = pgEnum('connection_attention_category', [
  'needs_reconnect',
  'needs_new_owner',
  'access_changed',
  'sync_error',
  'webhook_degraded',
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

// Durable outbox for provider pagination continuations. A queue handoff spans
// Postgres and Redis, so the row remains until the worker has observed an
// idempotent BullMQ accept. `surface` is non-null specifically so GitHub's
// independent pagination surfaces never collapse into one continuation.
export const integrationSyncContinuationHandoffs = pgTable(
  'integration_sync_continuation_handoffs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    externalId: text('external_id').notNull(),
    surface: text('surface').notNull().default(''),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    continuationAttempt: integer('continuation_attempt').notNull().default(0),
    claimToken: uuid('claim_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_sync_continuation_handoffs_target_unq').on(
      table.integrationId,
      table.resourceType,
      table.externalId,
      table.surface,
    ),
    index('integration_sync_continuation_handoffs_lease_idx').on(
      table.integrationId,
      table.leaseExpiresAt,
    ),
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
      onDelete: 'set null',
    }),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'set null',
    }),
    resourceShareId: uuid('resource_share_id').references(() => teamProviderResourceShares.id, {
      onDelete: 'set null',
    }),
    category: connectionAttentionCategory('category').notNull(),
    summary: text('summary').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    lastEmailedAt: timestamp('last_emailed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('connection_attention_unresolved_target_unq')
      .on(
        table.teamId,
        table.category,
        sql`COALESCE(${table.providerConnectionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.integrationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`COALESCE(${table.resourceShareId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.resolvedAt} IS NULL`),
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

export const integrationWebhookDeliveries = pgTable(
  'integration_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: integrationProvider('provider').notNull(),
    externalDeliveryId: text('external_delivery_id'),
    externalAccountId: text('external_account_id'),
    resourceKind: text('resource_kind'),
    externalResourceId: text('external_resource_id'),
    eventType: text('event_type').notNull(),
    action: text('action'),
    headers: jsonb('headers').notNull().default({}),
    payload: jsonb('payload').notNull().default({}),
    dedupKey: text('dedup_key').notNull(),
    status: text('status').notNull().default('accepted'),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_webhook_deliveries_provider_dedup_unq').on(
      table.provider,
      table.dedupKey,
    ),
    index('integration_webhook_deliveries_provider_received_idx').on(
      table.provider,
      table.receivedAt,
    ),
    index('integration_webhook_deliveries_external_account_idx').on(
      table.provider,
      table.externalAccountId,
    ),
    index('integration_webhook_deliveries_status_idx').on(table.status, table.receivedAt),
  ],
);

export const integrationWebhookDeliveryTargets = pgTable(
  'integration_webhook_delivery_targets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => integrationWebhookDeliveries.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    eventDedupKeys: text('event_dedup_keys').array(),
    syncJobId: text('sync_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_webhook_delivery_targets_delivery_integration_unq').on(
      table.deliveryId,
      table.integrationId,
    ),
    index('integration_webhook_delivery_targets_team_idx').on(table.teamId),
    index('integration_webhook_delivery_targets_integration_idx').on(table.integrationId),
    index('integration_webhook_delivery_targets_status_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const integrationWebhookSubscriptions = pgTable(
  'integration_webhook_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id').references(() => integrations.id, {
      onDelete: 'cascade',
    }),
    providerConnectionId: uuid('provider_connection_id').references(() => providerConnections.id, {
      onDelete: 'cascade',
    }),
    provider: integrationProvider('provider').notNull(),
    externalSubscriptionId: text('external_subscription_id'),
    resourceKind: text('resource_kind').notNull(),
    externalResourceId: text('external_resource_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_webhook_subscriptions_integration_resource_event_unq')
      .on(
        table.provider,
        table.integrationId,
        table.resourceKind,
        table.externalResourceId,
        table.eventType,
      )
      .where(sql`${table.integrationId} IS NOT NULL`),
    index('integration_webhook_subscriptions_integration_idx').on(table.integrationId),
    index('integration_webhook_subscriptions_connection_idx').on(table.providerConnectionId),
    index('integration_webhook_subscriptions_provider_resource_idx').on(
      table.provider,
      table.resourceKind,
      table.externalResourceId,
    ),
    index('integration_webhook_subscriptions_status_expires_idx').on(table.status, table.expiresAt),
  ],
);

export const integrationProviderBudgets = pgTable(
  'integration_provider_budgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: integrationProvider('provider').notNull(),
    appKey: text('app_key').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    scope: text('scope').notNull(),
    remaining: integer('remaining'),
    limit: integer('limit'),
    resetAt: timestamp('reset_at', { withTimezone: true }),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    reason: text('reason'),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('integration_provider_budgets_scope_unq').on(
      table.provider,
      table.appKey,
      table.externalAccountId,
      table.scope,
    ),
    index('integration_provider_budgets_pause_idx').on(table.provider, table.pausedUntil),
    index('integration_provider_budgets_account_idx').on(table.provider, table.externalAccountId),
  ],
);
