import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const pinTargetKind = pgEnum('pin_target_kind', [
  'object',
  'board',
  'document',
  'meeting',
  'saved_meeting',
  'calendar_event',
  'timeline_moment',
]);

/**
 * A user's ordered, mixed workspace shortcuts. Targets are deliberately
 * polymorphic: timeline moments have deterministic text identities while the
 * other target kinds currently use UUIDs. Target presentation and visibility
 * are always resolved from the owning domain table at read time.
 */
export const userPins = pgTable(
  'user_pins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetKind: pinTargetKind('target_kind').notNull(),
    targetKey: text('target_key').notNull(),
    sortKey: bigint('sort_key', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'user_pins_target_key_length_chk',
      sql`char_length(${table.targetKey}) BETWEEN 1 AND 500`,
    ),
    uniqueIndex('user_pins_team_user_target_unq').on(
      table.teamId,
      table.userId,
      table.targetKind,
      table.targetKey,
    ),
    index('user_pins_team_user_sort_idx').on(table.teamId, table.userId, table.sortKey, table.id),
    index('user_pins_team_user_kind_sort_idx').on(
      table.teamId,
      table.userId,
      table.targetKind,
      table.sortKey,
      table.id,
    ),
  ],
);
