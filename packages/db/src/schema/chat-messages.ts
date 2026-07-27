import { bigserial, index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatSessions } from '#src/schema/chat-sessions.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// One row per role-transition in a chat session. `content` is structured
// JSON (text + tool-call payloads + citation ids) so the UI can re-render
// rich messages without re-running the agent.
export const chatMessageRole = pgEnum('chat_message_role', ['user', 'assistant', 'tool', 'system']);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: chatMessageRole('role').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    content: jsonb('content').notNull(),
    sequence: bigserial('sequence', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('chat_messages_session_sequence_idx').on(table.sessionId, table.sequence)],
);
