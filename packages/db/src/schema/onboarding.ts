import { pgEnum, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

export const onboardingStep = pgEnum('onboarding_step', [
  'first_note',
  'telegram',
  'slack',
  'email_forwarding',
  'first_document',
  'first_integration',
]);

export const teamOnboardingCompletions = pgTable(
  'team_onboarding_completions',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    step: onboardingStep('step').notNull(),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.step] })],
);

export const userOnboardingDismissals = pgTable(
  'user_onboarding_dismissals',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);
