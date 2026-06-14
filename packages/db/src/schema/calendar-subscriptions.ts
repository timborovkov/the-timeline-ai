import { index, pgTable, timestamp, uniqueIndex, uuid, text } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const teamCalendarSubscriptions = pgTable(
  'team_calendar_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('team_calendar_subscriptions_team_user_unq').on(table.teamId, table.userId),
    uniqueIndex('team_calendar_subscriptions_token_hash_unq').on(table.tokenHash),
    index('team_calendar_subscriptions_team_idx').on(table.teamId),
  ],
);
