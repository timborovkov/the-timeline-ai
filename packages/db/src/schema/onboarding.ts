import { jsonb, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

export const teamOnboardingState = pgTable('team_onboarding_state', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => teams.id, { onDelete: 'cascade' }),
  completedKeys: jsonb('completed_keys').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userOnboardingState = pgTable(
  'user_onboarding_state',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);
