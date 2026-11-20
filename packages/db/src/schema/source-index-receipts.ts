import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

export const sourceIndexReceipts = pgTable(
  'source_index_receipts',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    model: text('model').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }).notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.kind, table.sourceId] })],
);
