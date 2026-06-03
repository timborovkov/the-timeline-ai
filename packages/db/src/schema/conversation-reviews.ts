import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { rawEvents } from '#src/schema/raw-events.js';
import { teams } from '#src/schema/teams.js';

export const conversationReviews = pgTable(
  'conversation_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    conversationKey: text('conversation_key').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull().default('pending'),
    lastRawEventId: uuid('last_raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    reviewedThroughRawEventId: uuid('reviewed_through_raw_event_id').references(
      () => rawEvents.id,
      {
        onDelete: 'set null',
      },
    ),
    reviewedThroughOccurredAt: timestamp('reviewed_through_occurred_at', { withTimezone: true }),
    quietUntil: timestamp('quiet_until', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('conversation_reviews_team_key_unq').on(table.teamId, table.conversationKey),
    index('conversation_reviews_team_status_quiet_idx').on(
      table.teamId,
      table.status,
      table.quietUntil,
    ),
    index('conversation_reviews_last_raw_event_idx').on(table.teamId, table.lastRawEventId),
    index('conversation_reviews_metadata_idx').using('gin', sql`${table.metadata}`),
  ],
);
