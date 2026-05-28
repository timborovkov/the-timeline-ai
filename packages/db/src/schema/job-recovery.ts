import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const jobRecoveryDismissals = pgTable(
  'job_recovery_dismissals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    jobKind: text('job_kind').notNull(),
    artifactKind: text('artifact_kind').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    dismissedByUserId: uuid('dismissed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('job_recovery_dismissals_target_unq').on(
      table.teamId,
      table.jobKind,
      table.artifactKind,
      table.artifactId,
    ),
    index('job_recovery_dismissals_team_created_idx').on(table.teamId, table.createdAt),
  ],
);
