import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from './teams.js';
import { users } from './users.js';

export const teamExportStatus = pgEnum('team_export_status', [
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);

export const teamExports = pgTable(
  'team_exports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: teamExportStatus('status').notNull().default('queued'),
    objectKey: text('object_key'),
    error: text('error'),
    manifest: jsonb('manifest').notNull().default({}),
    omissions: jsonb('omissions').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('team_exports_team_created_idx').on(table.teamId, table.createdAt),
    index('team_exports_status_expires_idx').on(table.status, table.expiresAt),
  ],
);
