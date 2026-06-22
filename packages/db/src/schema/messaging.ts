import { sql } from 'drizzle-orm';
import {
  boolean,
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

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const messageIntent = pgEnum('message_intent', [
  'team_invite',
  'support_request',
  'welcome',
  'email_verification',
  'daily_digest',
  'connection_attention',
]);

export const messageChannel = pgEnum('message_channel', ['email', 'in_app_digest']);

export const messageDeliveryStatus = pgEnum('message_delivery_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
]);

export const dailyDigestStatus = pgEnum('daily_digest_status', [
  'generated',
  'sent',
  'failed',
  'skipped',
]);

export const messageDeliveries = pgTable(
  'message_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intent: messageIntent('intent').notNull(),
    channel: messageChannel('channel').notNull(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    recipientEmail: text('recipient_email'),
    subject: text('subject'),
    status: messageDeliveryStatus('status').notNull().default('pending'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    dedupeKey: text('dedupe_key'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    index('message_deliveries_team_created_idx').on(table.teamId, table.createdAt),
    index('message_deliveries_user_created_idx').on(table.userId, table.createdAt),
    index('message_deliveries_intent_status_idx').on(table.intent, table.status),
    uniqueIndex('message_deliveries_dedupe_unq')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
  ],
);

export const dailyDigests = pgTable(
  'daily_digests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: dailyDigestStatus('status').notNull().default('generated'),
    deliveryId: uuid('delivery_id').references(() => messageDeliveries.id, {
      onDelete: 'set null',
    }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [
    index('daily_digests_team_user_generated_idx').on(
      table.teamId,
      table.userId,
      table.generatedAt,
    ),
    uniqueIndex('daily_digests_team_user_window_unq').on(
      table.teamId,
      table.userId,
      table.windowStart,
      table.windowEnd,
    ),
  ],
);

export const messagePreferences = pgTable(
  'message_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    dailyDigestEnabled: boolean('daily_digest_enabled').notNull().default(true),
    dailyDigestHour: integer('daily_digest_hour').notNull().default(12),
    timezone: text('timezone').notNull().default('Europe/Helsinki'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('message_preferences_team_user_unq')
      .on(table.teamId, table.userId)
      .where(sql`${table.teamId} IS NOT NULL AND ${table.userId} IS NOT NULL`),
    index('message_preferences_team_idx').on(table.teamId),
    index('message_preferences_user_idx').on(table.userId),
  ],
);
