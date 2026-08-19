import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { objectNotes } from '#src/schema/object-notes.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Resolved @mentions on object discussion comments. User mentions fan out to
// in-app notifications; a single agent mention per note can ping Timeline.
export const objectNoteMentions = pgTable(
  'object_note_mentions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id')
      .notNull()
      .references(() => objectNotes.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    mentionedUserId: uuid('mentioned_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('object_note_mentions_kind_chk', sql`${table.kind} IN ('user', 'agent')`),
    check(
      'object_note_mentions_user_kind_chk',
      sql`(
        (${table.kind} = 'user' AND ${table.mentionedUserId} IS NOT NULL)
        OR (${table.kind} = 'agent' AND ${table.mentionedUserId} IS NULL)
      )`,
    ),
    uniqueIndex('object_note_mentions_note_user_unq')
      .on(table.noteId, table.mentionedUserId)
      .where(sql`${table.kind} = 'user'`),
    uniqueIndex('object_note_mentions_note_agent_unq')
      .on(table.noteId)
      .where(sql`${table.kind} = 'agent'`),
    index('object_note_mentions_team_note_idx').on(table.teamId, table.noteId),
    index('object_note_mentions_team_user_idx').on(table.teamId, table.mentionedUserId),
  ],
);
