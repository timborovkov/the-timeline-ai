import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

// Content-free deletion inventory. Never cascade away unfinished provider cleanup.
export const evaluationTraceProjects = pgTable(
  'evaluation_trace_projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    name: text('name').notNull().unique(),
    endpoint: text('endpoint').notNull(),
    workspaceId: text('workspace_id').notNull(),
    reconcileAfter: timestamp('reconcile_after', { withTimezone: true }).notNull(),
    nextCleanupAt: timestamp('next_cleanup_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('evaluation_trace_projects_expiry_idx').on(table.expiresAt)],
);
