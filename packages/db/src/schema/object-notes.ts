import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Team discussion comments on a workspace object. Unlike raw_events
// (append-only), authors can edit and soft-delete their own comments.
// Every create/edit/delete also writes an immutable `raw_events` row +
// `object_changes` row so the history is reconstructable. Mentions live on
// `object_note_mentions`.
export const objectNotes = pgTable(
  'object_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('object_notes_team_entity_idx').on(table.teamId, table.entityId),
    index('object_notes_team_entity_created_id_idx').on(
      table.teamId,
      table.entityId,
      table.createdAt,
      table.id,
    ),
    index('object_notes_author_idx').on(table.authorUserId),
  ],
);
