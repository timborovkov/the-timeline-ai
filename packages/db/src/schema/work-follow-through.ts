import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const handoffSnapshots = pgTable(
  'handoff_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    turnId: uuid('turn_id').notNull(),
    body: jsonb('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('handoff_snapshots_team_turn_unq').on(table.teamId, table.turnId)],
);

export const savedWorkViews = pgTable(
  'saved_work_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    collection: text('collection').notNull(),
    targetId: uuid('target_id'),
    filters: jsonb('filters').$type<Record<string, string>>().notNull(),
    notify: boolean('notify').notNull().default(false),
    // Item IDs for the last complete evaluation. Reset on each opt-in.
    evaluatedThrough: timestamp('evaluated_through', { withTimezone: true }),
    baseline: jsonb('baseline')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('saved_work_views_owner_idx').on(table.teamId, table.userId)],
);

export interface SavedWorkViewChange {
  viewId: string;
  itemIds: string[];
}

export const savedWorkViewDigests = pgTable(
  'saved_work_view_digests',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    changes: jsonb('changes').$type<SavedWorkViewChange[]>().notNull(),
  },
  (table) => [
    uniqueIndex('saved_work_view_digests_window_unq').on(
      table.teamId,
      table.userId,
      table.windowEnd,
    ),
  ],
);
