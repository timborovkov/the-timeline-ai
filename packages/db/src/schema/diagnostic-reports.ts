import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Explicit user submissions, never automatic traces. Content is encrypted separately.
export const diagnosticReports = pgTable(
  'diagnostic_reports',
  {
    id: uuid('id').primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    tag: text('tag').notNull(),
    consentVersion: text('consent_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('diagnostic_reports_expiry_idx').on(table.expiresAt),
    index('diagnostic_reports_author_idx').on(table.teamId, table.userId, table.createdAt),
  ],
);
