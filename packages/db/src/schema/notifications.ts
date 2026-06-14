import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { agentSuggestionItems, agentSuggestions } from '#src/schema/agent-suggestions.js';
import { entities } from '#src/schema/entities.js';
import { objectChanges } from '#src/schema/object-changes.js';
import { teams } from '#src/schema/teams.js';
import { users } from '#src/schema/users.js';

// In-app notifications. v1 fan-out is in-process inside `updateObject` and
// the overdue-detector worker. Push/email delivery is out of scope for
// Phase 8 — recipients see them in `/app/inbox` only.
export const notificationKind = pgEnum('notification_kind', [
  'object_changed',
  'task_due',
  'task_overdue',
  'follow_up_overdue',
  'mention',
  'agent_suggestion',
  'connection_attention',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    entityId: uuid('entity_id').references(() => entities.id, { onDelete: 'cascade' }),
    objectChangeId: uuid('object_change_id').references(() => objectChanges.id, {
      onDelete: 'set null',
    }),
    agentSuggestionId: uuid('agent_suggestion_id').references(() => agentSuggestions.id, {
      onDelete: 'cascade',
    }),
    agentSuggestionItemId: uuid('agent_suggestion_item_id').references(
      () => agentSuggestionItems.id,
      {
        onDelete: 'set null',
      },
    ),
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    // Inbox query is "unread first, then newest". The sort directions and
    // NULLS placement must match `listNotifications` exactly — otherwise
    // the planner falls back to a sort node after the filter. Postgres
    // default for ASC is NULLS LAST, but unread rows have read_at IS NULL
    // and need to come first, so we pin NULLS FIRST. created_at is DESC
    // so the newest unread is on top of the unread group and the newest
    // read row leads the read group.
    index('notifications_team_user_inbox_idx').on(
      table.teamId.asc(),
      table.userId.asc(),
      sql`${table.readAt} ASC NULLS FIRST`,
      table.createdAt.desc(),
    ),
    index('notifications_team_entity_idx').on(table.teamId, table.entityId),
    index('notifications_team_suggestion_idx').on(table.teamId, table.agentSuggestionId),
    uniqueIndex('notifications_suggestion_recipient_unq')
      .on(table.teamId, table.userId, table.agentSuggestionId)
      .where(sql`${table.agentSuggestionId} IS NOT NULL`),
  ],
);
