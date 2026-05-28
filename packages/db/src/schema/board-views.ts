import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Saved object board configurations. `filter` is a structured JSON predicate
// (type, status[], stage[], owner, assignee, due range, metadata key
// matches); `groupBy` and `sort` shape the rendered view. App layer
// validates the shape; we keep it free-form here so adding a new filter
// doesn't require a migration.
export const boardKind = pgEnum('board_kind', ['kanban', 'table', 'list']);

export const boardViews = pgTable(
  'board_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    kind: boardKind('kind').notNull(),
    filter: jsonb('filter').notNull().default({}),
    groupBy: text('group_by'),
    sort: jsonb('sort').notNull().default({}),
    isShared: boolean('is_shared').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('board_views_team_shared_idx').on(table.teamId, table.isShared),
    index('board_views_created_by_idx').on(table.createdBy),
  ],
);
