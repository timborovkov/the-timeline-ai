import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { eventVisibility } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const ingestWebhooks = pgTable(
  'ingest_webhooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    visibilityDefault: eventVisibility('visibility_default').notNull().default('team'),
    proposalGenerationEnabled: boolean('proposal_generation_enabled').notNull().default(true),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ingest_webhooks_team_idx').on(table.teamId),
    index('ingest_webhooks_team_disabled_idx').on(table.teamId, table.disabledAt),
  ],
);

export const ingestWebhookCredentials = pgTable(
  'ingest_webhook_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => ingestWebhooks.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ingest_webhook_credentials_hash_unq').on(table.keyHash),
    index('ingest_webhook_credentials_team_idx').on(table.teamId),
    index('ingest_webhook_credentials_webhook_idx').on(table.webhookId),
  ],
);
