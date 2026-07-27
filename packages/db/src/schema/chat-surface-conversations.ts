import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { chatSessions } from '#src/schema/chat-sessions.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

export const chatSurfaceTurnStatus = pgEnum('chat_surface_turn_status', [
  'queued',
  'processing',
  'answered',
  'delivered',
  'timed_out',
  'failed',
  'cancelled',
]);

export const chatSurfaceSessionLinks = pgTable(
  'chat_surface_session_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    surface: text('surface').notNull(),
    externalConversationKey: text('external_conversation_key').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatSessionId: uuid('chat_session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chat_surface_session_links_surface_conversation_unq').on(
      table.surface,
      table.externalConversationKey,
    ),
    uniqueIndex('chat_surface_session_links_session_unq').on(table.chatSessionId),
    index('chat_surface_session_links_team_idx').on(table.teamId),
    index('chat_surface_session_links_user_idx').on(table.userId),
  ],
);

export const chatSurfaceTurns = pgTable(
  'chat_surface_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    surface: text('surface').notNull(),
    externalEventId: text('external_event_id').notNull(),
    externalMessageId: text('external_message_id').notNull(),
    externalConversationKey: text('external_conversation_key').notNull(),
    externalUserKey: text('external_user_key').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatSessionId: uuid('chat_session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    questionText: text('question_text').notNull(),
    answerText: text('answer_text'),
    status: chatSurfaceTurnStatus('status').notNull().default('queued'),
    errorCode: text('error_code'),
    requestedModelId: text('requested_model_id'),
    responseModelId: text('response_model_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chat_surface_turns_surface_event_unq').on(table.surface, table.externalEventId),
    uniqueIndex('chat_surface_turns_active_conversation_unq')
      .on(table.surface, table.externalConversationKey)
      .where(sql`${table.status} in ('queued', 'processing')`),
    index('chat_surface_turns_team_idx').on(table.teamId),
    index('chat_surface_turns_user_idx').on(table.userId),
    index('chat_surface_turns_session_idx').on(table.chatSessionId),
    index('chat_surface_turns_status_idx').on(table.status),
    index('chat_surface_turns_created_idx').on(table.createdAt),
  ],
);
