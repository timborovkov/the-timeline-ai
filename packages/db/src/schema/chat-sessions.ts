import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entities } from '#src/schema/entities.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// Persisted chat conversations. A session belongs to a team and a creator;
// it can optionally pin to a workspace object so "ask about this deal"
// chats group naturally on the object page. `contextTrail` stores the
// dashboard views attached to the conversation, current view first.
export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    surface: text('surface').notNull().default('web'),
    title: text('title'),
    pinnedEntityId: uuid('pinned_entity_id').references(() => entities.id, {
      onDelete: 'set null',
    }),
    contextTrail: jsonb('context_trail')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('chat_sessions_team_updated_idx').on(table.teamId, table.updatedAt),
    index('chat_sessions_team_pinned_idx').on(table.teamId, table.pinnedEntityId),
  ],
);
