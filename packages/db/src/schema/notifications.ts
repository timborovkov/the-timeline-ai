import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { entities } from './entities.js';
import { objectChanges } from './object-changes.js';
import { teams } from './teams.js';
import { users } from './users.js';

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
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    // Inbox query is "unread first, then newest". Putting readAt before
    // createdAt lets the planner pick this index directly.
    index('notifications_team_user_inbox_idx').on(
      table.teamId,
      table.userId,
      table.readAt,
      table.createdAt,
    ),
    index('notifications_team_entity_idx').on(table.teamId, table.entityId),
  ],
);
