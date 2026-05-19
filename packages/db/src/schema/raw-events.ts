import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from './teams';
import { users } from './users';

export const eventSource = pgEnum('event_source', ['web', 'telegram', 'email', 'system']);

export const eventVisibility = pgEnum('event_visibility', ['private', 'team', 'specific_users']);

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: eventSource('source').notNull(),
    contentText: text('content_text'),
    contentAudioUrl: text('content_audio_url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    sourceMetadata: jsonb('source_metadata').notNull().default({}),
  },
  (table) => [
    index('raw_events_team_idx').on(table.teamId),
    index('raw_events_team_occurred_idx').on(table.teamId, table.occurredAt),
    index('raw_events_author_idx').on(table.authorUserId),
  ],
);
